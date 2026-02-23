/**
 * Krill Email Plugin
 *
 * Handles inbound emails delivered as ai.krill.email.inbound Matrix events.
 * Can send replies via krill-api proxy or directly via Resend.
 *
 * Inbound flow:
 *   krill-api webhook → Matrix event (ai.krill.email.inbound) → this plugin → agent
 *
 * Outbound flow:
 *   Agent decides to reply → plugin sends via krill-api POST /v1/email/send
 */

const PLUGIN_NAME = 'krill-email';

const configSchema = {
  type: 'object',
  properties: {
    apiUrl: {
      type: 'string',
      description: 'Krill API URL',
      default: 'https://api.krillbot.network',
    },
    notifyOwner: {
      type: 'boolean',
      description: 'Notify agent owner of new emails',
      default: true,
    },
    autoReply: {
      type: 'boolean',
      description: 'Let agent auto-reply to emails',
      default: false,
    },
    signature: {
      type: 'string',
      description: 'Email signature appended to replies',
      default: '',
    },
  },
};

let pluginApi = null;
let pluginConfig = {
  apiUrl: 'https://api.krillbot.network',
  notifyOwner: true,
  autoReply: false,
  signature: '',
};

function register(api) {
  pluginApi = api;

  const userConfig = api.config?.plugins?.entries?.[PLUGIN_NAME]?.config || {};
  pluginConfig = { ...pluginConfig, ...userConfig };

  api.logger.info(`[${PLUGIN_NAME}] Registered (apiUrl: ${pluginConfig.apiUrl})`);
}

/**
 * Intercept ai.krill.email.inbound messages and present them to the agent.
 */
function interceptor(messageText, event) {
  if (!messageText || typeof messageText !== 'string') {
    return { handled: false };
  }

  // Try to detect ai.krill.email.inbound
  let parsed;
  try {
    if (messageText.trim().startsWith('{')) {
      parsed = JSON.parse(messageText);
    }
  } catch {
    return { handled: false };
  }

  if (!parsed || parsed.type !== 'ai.krill.email.inbound') {
    return { handled: false };
  }

  const email = parsed.content;
  if (!email) return { handled: false };

  const logger = pluginApi?.logger;
  logger?.info(`[${PLUGIN_NAME}] 📧 Inbound email from ${email.from}: "${email.subject}"`);

  // Format email as context for the agent
  const body = email.body_text || stripHtml(email.body_html) || '(empty body)';
  const truncatedBody = body.length > 2000 ? body.substring(0, 2000) + '\n...(truncated)' : body;

  const agentMessage = [
    `📧 **New Email Received**`,
    ``,
    `**From:** ${email.from_name ? `${email.from_name} <${email.from}>` : email.from}`,
    `**To:** ${email.to}`,
    `**Subject:** ${email.subject || '(no subject)'}`,
    `**Date:** ${email.date || 'unknown'}`,
    email.in_reply_to ? `**Thread:** Reply to previous conversation` : '',
    ``,
    `---`,
    ``,
    truncatedBody,
    ``,
    `---`,
    `*Email ID: ${email.email_id} — Reply with: "reply to email ${email.email_id}: your message"*`,
  ].filter(Boolean).join('\n');

  // Inject as a system event so the agent sees it
  if (pluginApi?.injectSystemEvent) {
    pluginApi.injectSystemEvent(agentMessage);
  } else if (pluginApi?.emit) {
    pluginApi.emit('system.event', agentMessage);
  }

  // Mark as handled so it doesn't reach the agent as a raw JSON message
  return { handled: true };
}

/**
 * Simple HTML tag stripper
 */
function stripHtml(html) {
  if (!html) return null;
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Send an email reply via krill-api proxy.
 * Called by the agent (e.g. via a tool or command).
 */
async function sendReply({ to, subject, bodyHtml, bodyText, replyToEmailId }) {
  const logger = pluginApi?.logger;
  const initConfig = pluginApi?.config?.plugins?.entries?.['krill-agent-init']?.config;

  if (!initConfig?.gatewayId || !initConfig?.gatewaySecret) {
    logger?.error(`[${PLUGIN_NAME}] Cannot send email: missing gateway credentials`);
    return { success: false, error: 'Missing gateway credentials' };
  }

  try {
    const resp = await fetch(`${pluginConfig.apiUrl}/v1/email/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateway_id: initConfig.gatewayId,
        gateway_secret: initConfig.gatewaySecret,
        to,
        subject,
        body_html: bodyHtml,
        body_text: bodyText,
        reply_to_email_id: replyToEmailId,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      logger?.error(`[${PLUGIN_NAME}] Send failed: ${JSON.stringify(data)}`);
      return { success: false, error: data.error || 'Send failed' };
    }

    logger?.info(`[${PLUGIN_NAME}] ✉️ Email sent: ${data.email_id}`);
    return { success: true, emailId: data.email_id };
  } catch (err) {
    logger?.error(`[${PLUGIN_NAME}] Send error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export default {
  name: PLUGIN_NAME,
  version: '1.0.0',
  description: 'Handles inbound/outbound email for Krill agents',
  configSchema,
  register,
  interceptor,
  // Exported for use by other plugins or the agent
  sendReply,
};
