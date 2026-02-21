/**
 * Krill Agent Init Plugin
 *
 * Registers the gateway with the Krill API on startup via check-in.
 * Collects system info (OS, arch, hostname, Node version, OpenClaw version, plugins).
 *
 * Provisioning (creating Matrix user, getting credentials) is handled
 * by setup-gateway-node.sh BEFORE the gateway starts.
 */
import os from "os";
// ── Config Schema ────────────────────────────────────────────────────
const configSchema = {
    type: "object",
    properties: {
        gatewayId: {
            type: "string",
            description: "Gateway ID (set by setup script)",
        },
        gatewaySecret: {
            type: "string",
            description: "Gateway secret (set by setup script)",
        },
        krillApiUrl: {
            type: "string",
            description: "Krill API URL (e.g., https://api.krillbot.network)",
        },
        agent: {
            type: "object",
            description: "Agent identity (set by setup script)",
            properties: {
                mxid: { type: "string" },
                displayName: { type: "string" },
                description: { type: "string" },
            },
            required: ["mxid", "displayName"],
        },
    },
    required: ["gatewayId", "gatewaySecret", "agent"],
};
// ── Plugin ───────────────────────────────────────────────────────────
const plugin = {
    id: "krill-agent-init",
    name: "Krill Agent Init",
    description: "Registers gateway with Krill API on startup via check-in",
    configSchema,
    register(api) {
        const config = api.config?.plugins?.entries?.["krill-agent-init"]?.config;
        if (!config) {
            api.logger.warn("[krill-init] No config found — plugin disabled");
            return;
        }
        if (!config.gatewayId || !config.gatewaySecret || !config.agent?.mxid) {
            api.logger.warn("[krill-init] Missing required config — skipping");
            return;
        }
        api.logger.info(`[krill-init] Agent: ${config.agent.displayName} (${config.agent.mxid})`);
        if (!config.krillApiUrl) {
            api.logger.warn("[krill-init] No krillApiUrl configured — skipping check-in");
            return;
        }
        // Collect system info
        // Detect OpenClaw version
        let openclawVersion = "unknown";
        try {
            // Try api.version first, then check if it's the plugin version (1.0.0)
            const v = api.version;
            if (v && v !== "1.0.0") {
                openclawVersion = v;
            }
            else {
                // Try reading from openclaw's own package.json via process.argv
                const { execSync } = require("child_process");
                openclawVersion = execSync("openclaw --version 2>/dev/null", { encoding: "utf8" }).trim() || "unknown";
            }
        }
        catch { }
        const systemInfo = {
            os: `${os.platform()} ${os.release()}`,
            arch: os.arch(),
            hostname: os.hostname(),
            node_version: process.version,
            openclaw_version: openclawVersion,
        };
        // Collect loaded plugins
        const plugins = [];
        try {
            const entries = api.config?.plugins?.entries;
            if (entries && typeof entries === "object") {
                for (const key of Object.keys(entries)) {
                    if (key !== "krill-agent-init")
                        plugins.push(key);
                }
            }
        }
        catch { }
        // Detect model - try multiple sources
        let model = "unknown";
        try {
            const cfg = api.config || {};
            model =
                cfg.models?.default ||
                    cfg.defaultModel ||
                    cfg.agents?.defaults?.model?.primary ||
                    cfg.agents?.defaults?.model ||
                    "unknown";
            // If still unknown, try reading from config file directly
            if (model === "unknown" || typeof model === "object") {
                const fs = require("fs");
                const path = require("path");
                const homeDir = os.homedir();
                const configPath = path.join(homeDir, ".openclaw", "openclaw.json");
                if (fs.existsSync(configPath)) {
                    const rawCfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
                    const m = rawCfg?.agents?.defaults?.model;
                    if (typeof m === "string")
                        model = m;
                    else if (typeof m === "object" && m?.primary)
                        model = m.primary;
                }
            }
        }
        catch { }
        // Fire-and-forget check-in (register() must NOT be async)
        setTimeout(() => {
            doCheckin(api, config, systemInfo, plugins, model);
        }, 5000);
    },
};
async function doCheckin(api, config, systemInfo, plugins, model) {
    const checkinBody = {
        gateway_id: config.gatewayId,
        gateway_secret: config.gatewaySecret,
        openclaw_version: systemInfo.openclaw_version,
        os: systemInfo.os,
        arch: systemInfo.arch,
        hostname: systemInfo.hostname,
        node_version: systemInfo.node_version,
        plugins,
        agent: {
            mxid: config.agent.mxid,
            display_name: config.agent.displayName,
            description: config.agent.description || `${config.agent.displayName} - Krill Network Agent`,
            model,
            capabilities: ["chat"],
        },
    };
    try {
        const res = await fetch(`${config.krillApiUrl}/v1/gateways/checkin`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(checkinBody),
        });
        if (res.ok) {
            api.logger.info(`[krill-init] ✅ Check-in OK: ${config.gatewayId} | ${systemInfo.os} ${systemInfo.arch} | OC ${systemInfo.openclaw_version}`);
            return;
        }
        api.logger.warn(`[krill-init] Check-in failed (${res.status}), trying legacy register...`);
    }
    catch (error) {
        api.logger.warn(`[krill-init] Check-in error: ${error.message}, trying legacy register...`);
    }
    // Fallback to legacy /register
    try {
        const res = await fetch(`${config.krillApiUrl}/v1/gateways/register`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-gateway-id": config.gatewayId,
                "x-gateway-secret": config.gatewaySecret,
            },
            body: JSON.stringify({
                serverIp: "0.0.0.0",
                version: "1.0.0",
                hostname: config.gatewayId,
            }),
        });
        if (res.ok) {
            api.logger.info(`[krill-init] ✅ Legacy register OK: ${config.gatewayId}`);
        }
        else {
            api.logger.warn(`[krill-init] Legacy register failed: ${res.status}`);
        }
    }
    catch (error) {
        api.logger.warn(`[krill-init] Legacy register error: ${error.message}`);
    }
}
export default plugin;
