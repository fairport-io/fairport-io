export interface User {
  id: string;
  name: string;
  password_hash: string;
  oauth_provider?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  owner_id: string;
  group_id: string | null;
  key_prefix: string;
  key_hash: string;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
}

export interface Role {
  id: string;
  name: string;
  permissions: { verbs: string[]; resources: string[]; resource_names_regex: string[] }[];
}

export interface Group {
  id: string;
  name: string;
  api_keys: string[];
  members: { ids: string[]; role_ids: string[] }[];
}

export interface Provider {
  id: string;
  name: string;
  base_url: string;
  models: string;
  api_key: string;
  owner_id: string | null;
  group_id: string | null;
  visibility: string;
  immutable?: boolean;
}

export interface Model {
  id: string;
  name: string;
  base_url?: string;
  owner_id?: string | null;
  visibility?: string;
}

export interface ModelPricing {
  model_id: string;
  input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number;
  rate_limits: string;
  queue_max_size: number;
}

export interface UsageEvent {
  id: string;
  api_key_id: string;
  model_id: string;
  provider_id: string;
  user_id: string;
  group_id: string | null;
  timestamp: number;
  input_tokens: number;
  output_tokens: number;
  source: string;
}

export interface Message {
  id: string;
  user_id: string;
  role: string;
  content: string;
  thinking_content?: string;
  timestamp: number;
}

export interface DbData {
  users: User[];
  api_keys: ApiKey[];
  roles: Role[];
  groups: Group[];
  models: Model[];
  messages: Message[];
  providers: Provider[];
  model_pricing: ModelPricing[];
  usage_events: UsageEvent[];
}

export interface DatabaseAdapter {
  load(): Promise<DbData>;
  save(data: DbData): Promise<void>;
  close?(): Promise<void>;
}

export type DatabaseType = 'yaml' | 'pglite' | 'postgres';
