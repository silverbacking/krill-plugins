/**
 * Synapse Admin API client for agent auto-provisioning
 * 
 * Docs: https://matrix-org.github.io/synapse/latest/admin_api/
 */

export interface SynapseAdminConfig {
  homeserver: string;
  adminToken: string;
}

export interface CreateUserRequest {
  username: string;
  password?: string;
  displayname?: string;
  admin?: boolean;
  deactivated?: boolean;
}

export interface UserInfo {
  name: string;
  displayname?: string;
  admin: boolean;
  deactivated: boolean;
  creation_ts: number;
}

export interface LoginResponse {
  access_token: string;
  device_id: string;
  user_id: string;
}

export class SynapseAdminClient {
  private homeserver: string;
  private adminToken: string;
  private domain: string;

  constructor(config: SynapseAdminConfig) {
    this.homeserver = config.homeserver.replace(/\/$/, '');
    this.adminToken = config.adminToken;
    // Extract domain from homeserver URL
    this.domain = new URL(this.homeserver).hostname;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: object
  ): Promise<T> {
    const url = `${this.homeserver}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.adminToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Synapse Admin API error: ${response.status} - ${error.errcode || 'Unknown'}: ${error.error || response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Check if a user exists
   */
  async userExists(userId: string): Promise<boolean> {
    try {
      await this.request<UserInfo>('GET', `/_synapse/admin/v2/users/${encodeURIComponent(userId)}`);
      return true;
    } catch (error: any) {
      if (error.message?.includes('404') || error.message?.includes('M_NOT_FOUND')) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get user info
   */
  async getUser(userId: string): Promise<UserInfo | null> {
    try {
      return await this.request<UserInfo>('GET', `/_synapse/admin/v2/users/${encodeURIComponent(userId)}`);
    } catch (error: any) {
      if (error.message?.includes('404') || error.message?.includes('M_NOT_FOUND')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create or update a user
   */
  async createOrUpdateUser(userId: string, options: CreateUserRequest): Promise<UserInfo> {
    return this.request<UserInfo>('PUT', `/_synapse/admin/v2/users/${encodeURIComponent(userId)}`, {
      password: options.password,
      displayname: options.displayname,
      admin: options.admin ?? false,
      deactivated: options.deactivated ?? false,
    });
  }

  /**
   * Create a new user with auto-generated password
   */
  async createUser(username: string, displayName?: string): Promise<{ userId: string; password: string }> {
    const userId = `@${username}:${this.domain}`;
    const password = this.generateSecurePassword();

    await this.createOrUpdateUser(userId, {
      username,
      password,
      displayname: displayName || username,
      admin: false,
    });

    return { userId, password };
  }

  /**
   * Login as a user to get an access token
   * Note: This uses the standard client API, not admin API
   */
  async loginAsUser(userId: string, password: string): Promise<LoginResponse> {
    const url = `${this.homeserver}/_matrix/client/v3/login`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: {
          type: 'm.id.user',
          user: userId,
        },
        password,
        initial_device_display_name: 'Krill Agent',
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Login failed: ${error.errcode || 'Unknown'}: ${error.error || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get or create an access token for a user using admin API
   * This creates a new device/session for the user
   */
  async getAccessTokenForUser(userId: string): Promise<{ accessToken: string; deviceId: string }> {
    // Create a login token for the user
    const tokenResponse = await this.request<{ login_token: string }>(
      'POST',
      `/_synapse/admin/v1/users/${encodeURIComponent(userId)}/login`
    );

    // Use the login token to get an access token
    const url = `${this.homeserver}/_matrix/client/v3/login`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'm.login.token',
        token: tokenResponse.login_token,
        initial_device_display_name: 'Krill Agent',
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Token login failed: ${error.errcode || 'Unknown'}: ${error.error || response.statusText}`);
    }

    const loginResult: LoginResponse = await response.json();
    return {
      accessToken: loginResult.access_token,
      deviceId: loginResult.device_id,
    };
  }

  /**
   * Set user avatar
   */
  async setUserAvatar(userId: string, accessToken: string, mxcUrl: string): Promise<void> {
    const url = `${this.homeserver}/_matrix/client/v3/profile/${encodeURIComponent(userId)}/avatar_url`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ avatar_url: mxcUrl }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Set avatar failed: ${error.errcode || 'Unknown'}: ${error.error || response.statusText}`);
    }
  }

  /**
   * Set user display name
   */
  async setUserDisplayName(userId: string, accessToken: string, displayName: string): Promise<void> {
    const url = `${this.homeserver}/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayname: displayName }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Set displayname failed: ${error.errcode || 'Unknown'}: ${error.error || response.statusText}`);
    }
  }

  /**
   * Generate a secure random password
   */
  private generateSecurePassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => chars[byte % chars.length]).join('');
  }
}

/**
 * Agent provisioning result
 */
export interface ProvisionedAgent {
  mxid: string;
  displayName: string;
  accessToken: string;
  deviceId: string;
  created: boolean;
}

/**
 * Auto-provision agents on startup
 */
export async function provisionAgents(
  adminClient: SynapseAdminClient,
  agents: Array<{ mxid: string; displayName: string; capabilities?: string[] }>
): Promise<ProvisionedAgent[]> {
  const results: ProvisionedAgent[] = [];

  for (const agent of agents) {
    try {
      const exists = await adminClient.userExists(agent.mxid);
      let created = false;

      if (!exists) {
        // Extract username from mxid
        const username = agent.mxid.split(':')[0].slice(1);
        await adminClient.createUser(username, agent.displayName);
        created = true;
        console.log(`[krill-admin] Created new agent: ${agent.mxid}`);
      }

      // Get access token for the agent
      const { accessToken, deviceId } = await adminClient.getAccessTokenForUser(agent.mxid);

      // Update display name if needed
      if (agent.displayName) {
        await adminClient.setUserDisplayName(agent.mxid, accessToken, agent.displayName);
      }

      results.push({
        mxid: agent.mxid,
        displayName: agent.displayName,
        accessToken,
        deviceId,
        created,
      });

      console.log(`[krill-admin] Provisioned agent: ${agent.mxid} (created: ${created})`);
    } catch (error) {
      console.error(`[krill-admin] Failed to provision agent ${agent.mxid}:`, error);
      throw error;
    }
  }

  return results;
}
