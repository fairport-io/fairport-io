/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo, Component, ReactNode } from 'react';
import { 
  Send, 
  Settings, 
  Key, 
  Trash2, 
  LogOut, 
  Moon, 
  Sun, 
  Monitor, 
  MessageSquare, 
  ChevronDown, 
  ChevronUp,
  ChevronLeft,
  Search,
  User,
  Bot,
  Plus,
  Copy,
  MoreVertical,
  Eye,
  Check,
  Server,
  Pencil,
  X,
  Menu,
  DollarSign,
  Users,
  Rocket
} from 'lucide-react';
// --- Error Boundary ---
class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: any) {
    console.error('React Error Boundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>
          <h2>Something went wrong</h2>
          <p style={{ fontSize: 12, color: '#666' }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 16px' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
type Role = 'user' | 'assistant';

interface Message {
  id: string;
  role: Role;
  content: string;
  thinkingBuffer?: string;  // Accumulated thinking content
  thinkingLines: string[];   // Array of thinking lines
  isThoughtExpanded: boolean;
  timestamp: number;
  inputTokens?: number;
  outputTokens?: number;
  tokensPerSecond?: number;
  ttft?: number;
  responseTime?: number;
  requestId?: string;
  rateLimitRemaining?: number;
  rateLimitLimit?: number;
  rateLimitUnit?: string;
  rateLimitWindows?: { remaining: number; limit: number; unit: string }[];
}

interface ApiKey {
  id: string;
  name: string;
  key: string;
  prefix: string;
  createdAt: number;
}

interface UsageEvent {
  id: string;
  timestamp: number;
  api_key_name: string;
  api_key_prefix: string;
  provider_name: string;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number;
  input_cost: number;
  output_cost: number;
  total_cost: number;
  source: string;
}

type Identity = { type: 'user'; id: string; name: string } | { type: 'group'; id: string; name: string };

interface Group {
  id: string;
  name: string;
  member_count: number;
}

interface GroupDetail {
  id: string;
  name: string;
  members: { id: string; name: string }[];
}

interface UserResources {
  user: { id: string; name: string };
  keys: { id: string; name: string; prefix: string; created_at: number }[];
  providers: { id: string; name: string; base_url: string; models: string }[];
  groups: { id: string; name: string }[];
}

interface Deployment {
  id: string;
  name: string;
  image: string;
  model: string;
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number;
  location: string;
  gpuType: string;
  numGpus: number;
  hostCpus: number;
  hostMemory: string;
}

interface Provider {
  id: string;
  name: string;
  base_url: string;
  models: string;
  visibility: string;
  immutable: boolean;
  rate_limits?: string;
  queue_max_size?: number;
}

type Tab = 'chat' | 'api' | 'providers' | 'groups' | 'usage' | 'settings' | 'deployments';
type Theme = 'light' | 'dark' | 'system';

// --- Constants ---
let APP_NAME = 'Chat'; // Will be updated from server config
const MAX_INPUT_TOKENS = 100000;
const estimateTokens = (text: string) => Math.ceil(text.length / 4);
// L3: crypto.randomUUID() is available in all modern browsers and Node.js 14.17+.
// The Math.random() fallback was removed as it is not cryptographically secure.
const genId = () => crypto.randomUUID();
const copyToClipboard = async (text: string) => {
  if (!navigator.clipboard) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    return;
  }
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
};
const OAUTH_PROVIDER_ICONS: Record<string, string> = {
  google: 'https://www.google.com/favicon.ico',
  microsoft: 'https://www.microsoft.com/favicon.ico',
  github: 'https://github.githubassets.com/favicons/favicon.svg',
};
const STORAGE_KEYS = {
  CHAT_HISTORY: 'app_chat_history',
  API_KEYS: 'app_api_keys',
  ACTIVE_KEY_ID: 'app_active_key_id',
  THEME: 'app_theme',
  ACTIVE_TAB: 'app_active_tab',
};
const TAB_LABELS: Record<Tab, string> = {
  chat: 'Chat',
  api: 'API',
  providers: 'Providers',
  usage: 'Usage',
  settings: 'Settings',
  deployments: 'Deployments',
};
const TAB_PATHS: Record<Tab, string> = {
  chat: '/chat',
  api: '/api',
  providers: '/providers',
  usage: '/usage',
  settings: '/settings',
  deployments: '/deployments',
};
const TAB_FROM_PATH: Record<string, Tab> = {
  '/chat': 'chat',
  '/api': 'api',
  '/providers': 'providers',
  '/usage': 'usage',
  '/settings': 'settings',
  '/deployments': 'deployments',
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [appName, setAppName] = useState<string>('Chat');
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const pathTab = TAB_FROM_PATH[window.location.pathname];
    if (pathTab) return pathTab;
    const stored = localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB);
    const validTabs: Tab[] = ['chat', 'api', 'providers', 'usage', 'settings', 'deployments'];
    if (stored && validTabs.includes(stored as Tab)) return stored as Tab;
    return 'chat';
  });
  const [selectedGroupSlug, setSelectedGroupSlug] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem(STORAGE_KEYS.THEME) as Theme) || 'system';
  });
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeIdentity, setActiveIdentity] = useState<Identity | null>(null);
  const [groupDetail, setGroupDetail] = useState<GroupDetail | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<{ id: string; name: string }[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedMemberData, setSelectedMemberData] = useState<UserResources | null>(null);
  const [selectedMemberUsage, setSelectedMemberUsage] = useState<UsageEvent[]>([]);
  const [addUserSearch, setAddUserSearch] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [monthPage, setMonthPage] = useState(0);
  const [activeKeyId, setActiveKeyId] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_KEY_ID) || '';
  });
  const [activeProviderId, setActiveProviderId] = useState<string>('');
  const [providerUrl, setProviderUrl] = useState<string>('');
  const [modelName, setModelName] = useState<string>('');
  const [isTyping, setIsTyping] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<string>('');
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('jwt_token'));
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');

  const authHeaders = (): Record<string, string> => {
    const t = token || localStorage.getItem('jwt_token');
    return t ? { 'Authorization': `Bearer ${t}` } : {};
  };
  const [oauthProviders, setOauthProviders] = useState<{ id: string; name: string }[]>([]);
  const [signupsEnabled, setSignupsEnabled] = useState(true);
  const [preferences, setPreferences] = useState(() => {
    return JSON.parse(localStorage.getItem('app_preferences') || '{"advancedTelemetry":false}');
  });
  const [chatPersistence, setChatPersistence] = useState<'client' | 'server'>('client');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const DEPLOY_IMAGES = ['vllm/vllm-openai:v0.20.2', 'ollama/ollama:0.23.4'];
  const DEPLOY_GPU_TYPES = ['None', 'NVIDIA A100', 'NVIDIA H100', 'NVIDIA L40S', 'NVIDIA A10G', 'AMD MI250'];
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [newDeployName, setNewDeployName] = useState('');
  const [newDeployImage, setNewDeployImage] = useState(DEPLOY_IMAGES[0]);
  const [newDeployModel, setNewDeployModel] = useState('');
  const [newDeployMin, setNewDeployMin] = useState(0);
  const [newDeployMax, setNewDeployMax] = useState(1);
  const [newDeployLocation, setNewDeployLocation] = useState('local');
  const [newDeployGpuType, setNewDeployGpuType] = useState('None');
  const [newDeployNumGpus, setNewDeployNumGpus] = useState(0);
  const [newDeployHostCpus, setNewDeployHostCpus] = useState(2);
  const [newDeployHostMemory, setNewDeployHostMemory] = useState('8Gi');
  const [editDeployData, setEditDeployData] = useState<Deployment | null>(null);
  const [editName, setEditName] = useState('');
  const [editImage, setEditImage] = useState(DEPLOY_IMAGES[0]);
  const [editModel, setEditModel] = useState('');
  const [editMin, setEditMin] = useState(0);
  const [editMax, setEditMax] = useState(1);
  const [editLocation, setEditLocation] = useState('local');
  const [editGpuType, setEditGpuType] = useState('None');
  const [editNumGpus, setEditNumGpus] = useState(0);
  const [editHostCpus, setEditHostCpus] = useState(2);
  const [editHostMemory, setEditHostMemory] = useState('8Gi');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Token limit check
  const currentTokens = useMemo(() => messages.reduce((sum, m) => sum + estimateTokens(m.content), 0), [messages]);
  const overLimit = currentTokens >= MAX_INPUT_TOKENS;

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem('app_preferences', JSON.stringify(preferences));
  }, [preferences]);

  const updatePreference = (key: string, value: boolean) => {
    setPreferences(prev => ({ ...prev, [key]: value }));
  };

  // --- Theme Logic ---
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  }, [theme]);

  // --- Persist messages to localStorage ---
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem(`${STORAGE_KEYS.CHAT_HISTORY}_${currentUser}`, JSON.stringify(messages));
    }
  }, [messages]);

  // --- Dynamic Page Title ---
  useEffect(() => {
    document.title = isLoggedIn ? `${appName} - ${TAB_LABELS[activeTab]}` : `${appName} - Login`;
  }, [appName, activeTab, isLoggedIn]);

  // --- Session & Initial Data ---
  useEffect(() => {
    // C1: Handle OAuth redirect — server now sends a short-lived one-time code
    // (?oauth_code=) instead of the JWT directly in the URL. We exchange it via
    // POST /api/auth/oauth/exchange so the token never appears in browser history
    // or server access logs.
    const params = new URLSearchParams(window.location.search);
    const oauthCode = params.get('oauth_code');
    if (oauthCode) {
      window.history.replaceState({}, '', window.location.pathname);
      fetch('/api/auth/oauth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: oauthCode }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.token) {
            localStorage.setItem('jwt_token', data.token);
            setToken(data.token);
            checkSession(data.token);
          }
        })
        .catch(() => {});
      return; // session will be checked inside the exchange callback above
    }
    const storedToken = token || localStorage.getItem('jwt_token');
    if (storedToken) {
      checkSession(storedToken);
    }
    fetch('/api/auth/oauth/config')
      .then(res => res.json())
      .then(data => setOauthProviders(data.providers || []))
      .catch(() => {});
    // Fetch app config (includes providers)
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.app_name) {
          setAppName(data.app_name);
          APP_NAME = data.app_name;
        }
        if (data.chat_persistence) {
          setChatPersistence(data.chat_persistence);
        }
        if (data.signups_enabled !== undefined) {
          setSignupsEnabled(data.signups_enabled);
        }
        // Load providers from config
        if (data.providers && Array.isArray(data.providers)) {
          setProviders(data.providers);
          // Set active provider to first one if not set
          if (data.providers.length > 0 && !activeProviderId) {
            setActiveProviderId(data.providers[0].id);
            setProviderUrl(data.providers[0].base_url);
            setModelName(data.providers[0].models.split(',')[0].trim());
          }
        }
      })
      .catch(() => {});
  }, []);

  const checkSession = async (sessionToken?: string) => {
    const t = sessionToken || token || localStorage.getItem('jwt_token');
    if (!t) return;
    try {
      const res = await fetch('/api/auth/session', { headers: { 'Cache-Control': 'no-cache', ...(t ? { 'Authorization': `Bearer ${t}` } : {}) } });
      const data = await res.json();
      if (data.logged_in) {
        setIsLoggedIn(true);
        setCurrentUser(data.username || '');
        setActiveIdentity({ type: 'user', id: data.user?.id || '', name: data.username || '' });
        await loadKeys();
        loadMessages(data.username || '');
        loadUsage();
        loadGroups();
      } else {
        localStorage.removeItem('jwt_token');
        setToken(null);
      }
    } catch (e) {}
  };

  const loadKeys = async (groupId?: string) => {
    try {
      const url = groupId ? `/api/keys?group_id=${groupId}` : '/api/keys';
      const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache', ...authHeaders() } });
      if (res.ok) {
        const data = await res.json();
        const mappedKeys = data.map((k: any) => ({
          id: k.id,
          name: k.name,
          key: k.key,
          prefix: k.key_prefix,
          createdAt: k.created_at
        }));
        setApiKeys(mappedKeys);
        
        setActiveKeyId(prevId => {
          if (mappedKeys.length > 0 && (!prevId || !mappedKeys.find((k: any) => k.id === prevId))) {
            return mappedKeys[0].id;
          }
          return prevId;
        });
      } else {
        console.error('Failed to load keys:', res.status);
      }
    } catch (e) {
      console.error('Failed to load keys:', e);
    }
  };

  const loadGroups = async () => {
    try {
      const res = await fetch('/api/groups', { headers: { 'Cache-Control': 'no-cache', ...authHeaders() } });
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
        setIsAdmin(data.is_admin || false);
      }
    } catch (e) {
      console.error('Failed to load groups:', e);
    }
  };

  const openGroupDetail = async (slug: string) => {
    setSelectedGroupSlug(slug);
    setGroupDetail(null);
    setMemberSearch('');
    setMemberResults([]);
    setSelectedMemberId(null);
    setSelectedMemberData(null);
    setAddUserSearch('');
    setMemberResults([]);
    try {
      const res = await fetch(`/api/groups/${slug}`, { headers: { ...authHeaders() } });
      if (res.ok) {
        const data = await res.json();
        setGroupDetail(data);
      }
    } catch (e) {
      console.error('Failed to load group detail:', e);
    }
  };

  const closeGroupDetail = () => {
    setSelectedGroupSlug(null);
    setGroupDetail(null);
    setMemberSearch('');
    setMemberResults([]);
    setSelectedMemberId(null);
    setSelectedMemberData(null);
    setSelectedMemberUsage([]);
    setAddUserSearch('');
  };

  const addMemberByEmail = async () => {
    const email = addUserSearch.trim();
    if (!email || !selectedGroupSlug) return;
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(email)}`, { headers: { ...authHeaders() } });
      if (res.ok) {
        const users = await res.json();
        const exact = users.find((u: any) => u.name.toLowerCase() === email.toLowerCase());
        if (exact) {
          await fetch(`/api/groups/${selectedGroupSlug}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ user_id: exact.id }),
          });
        }
      }
      setAddUserSearch('');
      openGroupDetail(selectedGroupSlug!);
    } catch (e) {
      console.error('Failed to add member:', e);
    }
  };

  const searchMembers = async () => {
    if (!selectedGroupSlug) return;
    const q = memberSearch.trim();
    if (!q) {
      setMemberResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/groups/${selectedGroupSlug}/members?q=${encodeURIComponent(q)}`, { headers: { ...authHeaders() } });
      if (res.ok) {
        setMemberResults(await res.json());
      } else {
        const errDetail = await res.text().catch(() => '');
        console.error('Search members failed:', res.status, errDetail);
        setMemberResults([]);
      }
    } catch (e) {
      console.error('Failed to search members:', e);
      setMemberResults([]);
    }
  };

  const removeMemberFromGroup = async (userId: string) => {
    if (!selectedGroupSlug) return;
    if (!confirm('Remove this user from the group?')) return;
    const res = await fetch(`/api/groups/${selectedGroupSlug}/members/${userId}`, { method: 'DELETE', headers: { ...authHeaders() } });
    if (res.ok) {
      if (selectedMemberId === userId) {
        setSelectedMemberId(null);
        setSelectedMemberData(null);
      }
      openGroupDetail(selectedGroupSlug);
    }
  };

  const selectMember = async (memberId: string) => {
    setSelectedMemberId(memberId);
    setSelectedMemberData(null);
    setSelectedMemberUsage([]);
    try {
      const [res, usageRes] = await Promise.all([
        fetch(`/api/admin/users/${memberId}`, { headers: { ...authHeaders() } }),
        fetch(`/api/admin/users/${memberId}/usage`, { headers: { ...authHeaders() } }),
      ]);
      if (res.ok) {
        const data = await res.json();
        setSelectedMemberData(data);
      }
      if (usageRes.ok) {
        const usageData = await usageRes.json();
        setSelectedMemberUsage(usageData);
      }
    } catch (e) {
      console.error('Failed to load user resources:', e);
    }
  };

  const adminDeleteKey = async (userId: string, keyId: string) => {
    const res = await fetch(`/api/admin/users/${userId}/keys/${keyId}`, { method: 'DELETE', headers: { ...authHeaders() } });
    if (res.ok) selectMember(userId);
  };

  const adminDeleteProvider = async (userId: string, providerId: string) => {
    const res = await fetch(`/api/admin/users/${userId}/providers/${providerId}`, { method: 'DELETE', headers: { ...authHeaders() } });
    if (res.ok) selectMember(userId);
  };

  const adminDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This action is permanent.')) return;
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', headers: { ...authHeaders() } });
    if (res.ok) {
      closeGroupDetail();
      loadGroups();
    }
  };

  const adminRemoveFromGroup = async (userId: string, groupSlug: string) => {
    const res = await fetch(`/api/admin/users/${userId}/groups/${groupSlug}`, { method: 'DELETE', headers: { ...authHeaders() } });
    if (res.ok && selectedMemberId) {
      selectMember(selectedMemberId);
      if (selectedGroupSlug && groupDetail) {
        setGroupDetail({
          ...groupDetail,
          members: groupDetail.members.filter(m => m.id !== userId)
        });
        setMemberResults(prev => prev.filter(m => m.id !== userId));
      }
    }
  };

  const loadUsage = async (groupId?: string) => {
    try {
      const url = groupId ? `/api/usage?group_id=${groupId}` : '/api/usage';
      const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache', ...authHeaders() } });
      if (res.ok) {
        const data = await res.json();
        setUsageEvents(data);
      }
    } catch (e) {
      console.error('Failed to load usage:', e);
    }
  };

  useEffect(() => {
    if (activeTab === 'usage') {
      const groupId = activeIdentity?.type === 'group' ? activeIdentity.id : undefined;
      loadUsage(groupId);
    }
    if (activeTab === 'groups') {
      loadGroups();
    }
  }, [activeTab]);

  const loadMessages = async (userName?: string) => {
    const key = userName ? `${STORAGE_KEYS.CHAT_HISTORY}_${userName}` : STORAGE_KEYS.CHAT_HISTORY;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      }
    } catch (e) {}
    try {
      const res = await fetch('/api/messages', { headers: { 'Cache-Control': 'no-cache', ...authHeaders() } });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          thinkingLines: (m.thinking_content || '').split('\n').filter((l: string) => l.trim()),
          isThoughtExpanded: false,
          timestamp: m.timestamp
        })));
      }
    } catch (e) {}
  };

  const loadProviders = async (groupId?: string) => {
    try {
      const url = groupId ? `/api/providers?group_id=${groupId}` : '/api/providers';
      const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache', ...authHeaders() } });
      if (res.ok) {
        const data = await res.json();
        setProviders(data);
        
        // Set active provider to first one if not set
        if (data.length > 0 && !activeProviderId) {
          setActiveProviderId(data[0].id);
          setProviderUrl(data[0].base_url);
          setModelName(data[0].models.split(',')[0].trim());
        }
      }
    } catch (e) {
      console.error('Failed to load providers:', e);
    }
  };

  const loadConfig = async () => {
    try {
      await fetch('/api/config');
    } catch (e) {}
  };

  useEffect(() => {
    if (activeProviderId) {
      const provider = providers.find(p => p.id === activeProviderId);
      if (provider) {
        setProviderUrl(provider.base_url);
        setModelName(provider.models.split(',')[0].trim());
      }
    }
  }, [activeProviderId, providers]);

  useEffect(() => {
    try {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    } catch (e) {}
  }, [messages, isLoggedIn]);

  useEffect(() => {
    if (activeKeyId) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_KEY_ID, activeKeyId);
    }
  }, [activeKeyId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, activeTab);
    const target = !isLoggedIn ? '/login' : TAB_PATHS[activeTab];
    if (window.location.pathname !== target) {
      window.history.replaceState(null, '', target);
    }
  }, [activeTab, isLoggedIn]);

  useEffect(() => {
    if (activeTab === 'settings' && activeIdentity?.type === 'group') {
      openGroupDetail(activeIdentity.id);
    }
  }, [activeTab, activeIdentity]);

  // --- Auth Handlers ---
  const handleAuth = async (action: 'login' | 'signup') => {
    setAuthError('');
    try {
      const res = await fetch(`/api/auth/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('jwt_token', data.token);
        setToken(data.token);
        setIsLoggedIn(true);
        setCurrentUser(data.user?.name || authForm.username);
        setActiveIdentity({ type: 'user', id: data.user?.id || '', name: data.user?.name || authForm.username });
        setActiveTab('chat');
        await loadKeys();
        // Load config and providers
        const configRes = await fetch('/api/config');
        const configData = await configRes.json();
        if (configData.providers && Array.isArray(configData.providers)) {
          setProviders(configData.providers);
          if (configData.providers.length > 0) {
            setActiveProviderId(configData.providers[0].id);
            setProviderUrl(configData.providers[0].base_url);
            setModelName(configData.providers[0].models.split(',')[0].trim());
          }
        }
        const userName = data.user?.name || authForm.username;
        loadMessages(userName);
        loadUsage();
        loadGroups();
      } else {
        setAuthError(data.detail || 'Authentication failed');
      }
    } catch (e) {
      setAuthError('Network error');
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('jwt_token');
    if (currentUser) {
      localStorage.removeItem(`${STORAGE_KEYS.CHAT_HISTORY}_${currentUser}`);
    }
    localStorage.removeItem(STORAGE_KEYS.CHAT_HISTORY);
    setToken(null);
    setIsLoggedIn(false);
    setCurrentUser('');
    setMessages([]);
    setApiKeys([]);
  };

  // --- Chat Handlers ---
  const handleSendMessage = async () => {
    if (!input.trim() || isTyping) return;
    if (overLimit) return;

    const userMessage: Message = {
      id: genId(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    const assistantMessageId = genId();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      thinkingLines: [],
      isThoughtExpanded: false,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, assistantMessage]);

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders(),
          'x-api-key-id': activeKeyId || ''
        },
        body: JSON.stringify({ 
          messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
          provider_id: activeProviderId
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errorData.detail || 'Stream error');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'response') {
              setMessages(prev => prev.map(m => 
                m.id === assistantMessageId ? { ...m, content: (m.content || '') + data.content } : m
              ));
            } else if (data.type === 'thinking') {
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantMessageId) return m;
                const currentBuffer = m.thinkingBuffer || '';
                const newBuffer = currentBuffer + data.content;
                const lines = newBuffer.split('\n').filter((l: string) => l.trim());
                return { ...m, thinkingBuffer: newBuffer, thinkingLines: lines };
              }));
            } else if (data.type === 'done') {
              setMessages(prev => prev.map(m =>
                m.id === assistantMessageId ? { 
                  ...m, 
                  inputTokens: data.inputTokens, 
                  outputTokens: data.outputTokens, 
                  tokensPerSecond: data.tokensPerSecond,
                  ttft: data.ttft,
                  responseTime: data.responseTime,
                  requestId: data.requestId,
                  rateLimitRemaining: data.rateLimitRemaining,
                  rateLimitLimit: data.rateLimitLimit,
                  rateLimitUnit: data.rateLimitUnit,
                  rateLimitWindows: data.rateLimitWindows
                } : m
              ));
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    } catch (e: any) {
      console.error('Stream error:', e);
      setMessages(prev => prev.map(m => 
        m.id === assistantMessageId ? { ...m, content: `Error: ${e.message}` } : m
      ));
    } finally {
      setIsTyping(false);
    }
  };

  const clearChat = async () => {
    if (confirm('Are you sure you want to clear the conversation?')) {
      if (currentUser) {
        localStorage.removeItem(`${STORAGE_KEYS.CHAT_HISTORY}_${currentUser}`);
      }
      await fetch('/api/messages', { method: 'DELETE', headers: { ...authHeaders() } });
      setMessages([]);
    }
  };

  const addApiKey = async (name: string): Promise<string | null> => {
    try {
      const groupId = activeIdentity?.type === 'group' ? activeIdentity.id : undefined;
      const body: any = { name };
      if (groupId) body.group_id = groupId;
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (res.ok) {
        setShowNewKey(data.key);
        await loadKeys(groupId);
        return null;
      }
      return data.detail || 'Failed to create key';
    } catch (err) {
      console.error('Failed to create key:', err);
      return 'Network error';
    }
  };

  const removeApiKey = async (id: string) => {
    await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    loadKeys();
  };

  // --- Provider Handlers ---
  const addProvider = async (name: string, baseUrl: string, models: string, rateLimits?: string, apiKey?: string, queueMaxSize?: number): Promise<string | null> => {
    try {
      const groupId = activeIdentity?.type === 'group' ? activeIdentity.id : undefined;
      const body: any = { name, base_url: baseUrl, models, rate_limits: rateLimits, api_key: apiKey || undefined, queue_max_size: queueMaxSize };
      if (groupId) body.group_id = groupId;
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (res.ok) {
        await loadProviders(groupId);
        return null;
      }
      return data.detail || 'Failed to create provider';
    } catch (err) {
      console.error('Failed to create provider:', err);
      return 'Network error';
    }
  };

  const updateProvider = async (id: string, updates: { name?: string; base_url?: string; models?: string; api_key?: string; rate_limits?: string; queue_max_size?: number }): Promise<string | null> => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (res.ok) {
        await loadProviders();
        return null;
      }
      return data.detail || 'Failed to update provider';
    } catch (err) {
      console.error('Failed to update provider:', err);
      return 'Network error';
    }
  };

  const removeProvider = async (id: string) => {
    await fetch(`/api/providers/${id}`, { method: 'DELETE', headers: { ...authHeaders() } });
    loadProviders();
  };

  const deleteAccount = async () => {
    if (deleteConfirmEmail !== currentUser) return;
    try {
      const res = await fetch('/api/auth/account', { method: 'DELETE', headers: { ...authHeaders() } });
      if (res.ok) {
        localStorage.removeItem('jwt_token');
        if (currentUser) {
          localStorage.removeItem(`${STORAGE_KEYS.CHAT_HISTORY}_${currentUser}`);
        }
        setToken(null);
        setIsLoggedIn(false);
        setCurrentUser('');
        setMessages([]);
        setApiKeys([]);
        setShowDeleteConfirm(false);
        setDeleteConfirmEmail('');
      }
    } catch (e) {
      console.error('Failed to delete account:', e);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 flex items-center justify-center p-6 text-slate-900 dark:text-zinc-100 transition-colors duration-200">
        <div className="absolute top-6 right-6">
          <ThemeSwitcher current={theme} onSelect={setTheme} />
        </div>
        
        <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 shadow-xl p-8 space-y-8">
          <div className="text-center">
            <div className="inline-flex w-16 h-16 bg-indigo-600 rounded-2xl items-center justify-center text-white text-2xl font-bold mb-4 shadow-lg shadow-indigo-600/30">{appName.charAt(0).toUpperCase()}</div>
            <h1 className="text-2xl font-bold">Welcome to {appName}</h1>
            <p className="text-slate-500 dark:text-zinc-400 text-sm mt-1">Please authenticate to continue.</p>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Email Address</label>
              <input 
                type="text" 
                value={authForm.username}
                onChange={e => setAuthForm({ ...authForm, username: e.target.value })}
                className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-2xl p-4 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-zinc-600"
                placeholder="you@example.com"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Password</label>
              <input 
                type="password" 
                value={authForm.password}
                onChange={e => setAuthForm({ ...authForm, password: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAuth('login');
                  }
                }}
                className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-2xl p-4 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-zinc-600"
                placeholder="Min. 8 characters"
              />
            </div>
          </div>

          {authError && <p className="text-xs text-red-500 font-medium text-center">{authError}</p>}

          <div className="flex flex-col gap-3">
            <button 
              onClick={() => handleAuth('login')}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-2xl font-bold shadow-lg shadow-indigo-600/20 active:scale-[0.99] transition-all"
            >
              Sign In
            </button>
            {signupsEnabled && (
              <button 
                onClick={() => handleAuth('signup')}
                className="w-full bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-900 dark:text-zinc-100 py-4 rounded-2xl font-bold active:scale-[0.99] transition-all"
              >
                Create New Account
              </button>
            )}
          </div>

          {oauthProviders.length > 0 && (
            <>
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100 dark:border-zinc-800"></div></div>
                <div className="relative flex justify-center text-xs uppercase tracking-widest"><span className="bg-white dark:bg-zinc-900 px-4 text-slate-400">External Sync</span></div>
              </div>
              <div className="flex flex-col gap-3">
                {oauthProviders.map(p => (
                  <a
                    key={p.id}
                    href={`/api/auth/oauth/authorize?provider=${p.id}`}
                    className="w-full border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800 flex items-center justify-center gap-3 py-4 rounded-2xl font-bold transition-all"
                  >
                    {OAUTH_PROVIDER_ICONS[p.id] ? (
                      <img src={OAUTH_PROVIDER_ICONS[p.id]} className="w-4 h-4 opacity-70" alt="" />
                    ) : (
                      <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold text-slate-400 rounded-full bg-slate-200 dark:bg-zinc-700">
                        {p.name.charAt(0)}
                      </span>
                    )}
                    Continue with {p.name}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div className="flex h-screen bg-slate-50 dark:bg-zinc-950 text-slate-900 dark:text-zinc-100 transition-colors duration-200">

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between px-4 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} aria-label="Menu" className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl transition-colors">
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold tracking-tight">{appName}</h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeSwitcher current={theme} onSelect={setTheme} />
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        w-72 bg-white dark:bg-zinc-900 border-r border-slate-200 dark:border-zinc-800 flex flex-col shadow-sm
        md:relative md:flex
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
      `}>
        <div className="md:hidden flex items-center justify-between p-4 border-b border-slate-200 dark:border-zinc-800">
          <h1 className="text-lg font-bold tracking-tight">{appName}</h1>
          <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="hidden md:block p-6 border-b border-slate-200 dark:border-zinc-800">
          <h1 className="text-xl font-bold flex items-center gap-2 tracking-tight">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white text-sm shadow-lg shadow-indigo-600/30">{appName.charAt(0).toUpperCase()}</div>
            {appName}
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <SidebarButton 
            active={activeTab === 'chat'} 
            onClick={() => { setActiveTab('chat'); setSidebarOpen(false); }}
            icon={<MessageSquare className="w-4 h-4" />}
            label="Chat"
          />
          <SidebarButton 
            active={activeTab === 'api'} 
            onClick={() => { setActiveTab('api'); setSidebarOpen(false); }}
            icon={<Key className="w-4 h-4" />}
            label="API"
          />
          <SidebarButton 
            active={activeTab === 'providers'} 
            onClick={() => { setActiveTab('providers'); setSidebarOpen(false); }}
            icon={<Server className="w-4 h-4" />}
            label="Providers"
          />
          <SidebarButton
            active={activeTab === 'usage'}
            onClick={() => { setActiveTab('usage'); setSidebarOpen(false); }}
            icon={<DollarSign className="w-4 h-4" />}
            label="Usage"
          />
          <SidebarButton 
            active={activeTab === 'deployments'} 
            onClick={() => { setActiveTab('deployments'); setSidebarOpen(false); }}
            icon={<Rocket className="w-4 h-4" />}
            label="Deployments"
          />
          <SidebarButton 
            active={activeTab === 'settings'} 
            onClick={() => { setActiveTab('settings'); setSidebarOpen(false); }}
            icon={<Settings className="w-4 h-4" />}
            label="Settings"
          />
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-zinc-800 space-y-1">
          <button 
            onClick={clearChat}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl transition-all"
          >
            <Trash2 className="w-4 h-4" /> Clear History
          </button>
          <button 
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-all"
          >
            <LogOut className="w-4 h-4" /> Log out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden md:pt-0 pt-14">
        {/* Header / Nav Bar */}
        <header className="md:h-16 min-h-12 flex flex-row-reverse items-center justify-between md:px-6 px-3 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-md border-b border-slate-200 dark:border-zinc-800 z-10">
          <div className="hidden md:flex items-center gap-2">
            <ThemeSwitcher current={theme} onSelect={setTheme} />
          </div>

          <div className="flex items-center md:gap-3 gap-1">
            {activeIdentity && (
              <>
                <select
                  value={`${activeIdentity.type}:${activeIdentity.id}`}
                  onChange={(e) => {
                    const [type, ...idParts] = e.target.value.split(':');
                    const id = idParts.join(':');
                    if (type === 'group') {
                      const group = groups.find(g => g.id === id);
                      if (group) { setActiveKeyId(''); setActiveProviderId(''); setModelName(''); setActiveIdentity({ type: 'group', id: group.id, name: group.name }); }
                    } else {
                      setActiveKeyId(''); setActiveProviderId(''); setModelName(''); setActiveIdentity({ type: 'user', id: currentUser, name: currentUser });
                    }
                  }}
                  className="text-[11px] font-bold bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-full md:px-3 px-2 py-1.5 text-slate-600 dark:text-zinc-400 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer max-w-[120px] md:max-w-none"
                >
                  <option value={`user:${currentUser}`}>User: {currentUser}</option>
                  {groups.filter(g => g.id !== 'global_admin' || isAdmin).map(g => (
                    <option key={g.id} value={`group:${g.id}`}>Group: {g.name}</option>
                  ))}
                </select>
                <span className="w-px h-4 bg-slate-300 dark:bg-zinc-700 mx-1" />
              </>
            )}
            <span className="hidden md:inline text-[11px] font-bold text-slate-600 dark:text-zinc-400">Active API Key:</span>
            <select
              value={activeKeyId}
              onChange={(e) => setActiveKeyId(e.target.value)}
              className="text-[11px] font-bold bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-full md:px-3 px-2 py-1.5 text-slate-600 dark:text-zinc-400 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer max-w-[100px] md:max-w-none"
            >
              {!activeKeyId && <option value="">Select a key</option>}
              {apiKeys.map(k => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>

            <span className="hidden md:inline text-[11px] font-bold text-slate-600 dark:text-zinc-400">Provider:</span>
            <select
              value={activeProviderId}
              onChange={(e) => {
                setActiveProviderId(e.target.value);
                // Reset model selection when provider changes
                const provider = providers.find(p => p.id === e.target.value);
                if (provider) {
                  const models = provider.models.split(',').map(m => m.trim());
                  if (models.length > 0) {
                    setModelName(models[0]);
                  }
                }
              }}
              className="text-[11px] font-bold bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-full md:px-3 px-2 py-1.5 text-slate-600 dark:text-zinc-400 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer max-w-[100px] md:max-w-none"
            >
              {!activeProviderId && <option value="">Select a provider</option>}
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            <span className="hidden md:inline text-[11px] font-bold text-slate-600 dark:text-zinc-400">Model:</span>
            <select
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="text-[11px] font-bold bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-full md:px-3 px-2 py-1.5 text-slate-600 dark:text-zinc-400 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer max-w-[100px] md:max-w-none"
            >
              {providers.find(p => p.id === activeProviderId)?.models.split(',').map(m => (
                <option key={m.trim()} value={m.trim()}>{m.trim()}</option>
              )) || <option value="">Select provider first</option>}
            </select>

            <span className="hidden xl:inline text-[11px] font-bold text-slate-500 dark:text-zinc-500 mr-1">Chat Storage:</span>
            <span className="text-[11px] font-bold bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-full md:px-3 px-2 py-1.5 text-slate-600 dark:text-zinc-400 inline-flex items-center gap-1 select-none">
              {chatPersistence === 'client' ? 'Browser' : 'Server'}
              <ChevronDown className="w-3 h-3 opacity-30" />
            </span>

            <div className={`w-2 h-2 rounded-full ${activeKeyId ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse' : 'bg-amber-500'}`} />
          </div>
        </header>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto" ref={scrollRef}>
          {activeTab === 'chat' && (
            <div className="flex flex-col items-center min-h-full pb-32">
              {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-10 max-w-lg mt-20">
                  <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6 font-bold text-2xl shadow-xl">
                    {appName.charAt(0).toUpperCase()}
                  </div>
                  <h2 className="text-2xl font-bold mb-2">Welcome to {appName}</h2>
                  <div className="grid grid-cols-2 gap-4 mt-10 w-full">
                    <ExamplePrompt label="Explain Quantum Physics" onClick={setInput} />
                    <ExamplePrompt label="Write a React Hook" onClick={setInput} />
                    <ExamplePrompt label="Architect a Microservice" onClick={setInput} />
                    <ExamplePrompt label="Draft a Marketing Plan" onClick={setInput} />
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-4xl">
                  {messages.map((m, idx) => (
                    <MessageRow 
                      key={m.id} 
                      message={m} 
                      userEmail={currentUser}
                      appName={appName}
                      advancedTelemetry={preferences.advancedTelemetry}
                      currentTokens={currentTokens}
                      onToggleThought={() => {
                        setMessages(prev => prev.map((msg, i) => 
                          i === idx ? { ...msg, isThoughtExpanded: !msg.isThoughtExpanded } : msg
                        ));
                      }}
                    />
                  ))}
                  {isTyping && (
                    <div className="p-6 border-b border-slate-100 dark:border-zinc-900/50 bg-slate-50/50 dark:bg-zinc-900/30">
                      <div className="max-w-3xl mx-auto flex gap-6">
                         <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex-shrink-0 animate-pulse shadow-lg shadow-indigo-600/30" />
                         <div className="flex gap-1.5 items-center">
                           <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                           <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                           <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                         </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

            {activeTab === 'providers' && (
              <div className="max-w-3xl mx-auto py-12 px-6 w-full">
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 overflow-hidden shadow-xl shadow-slate-200/50 dark:shadow-none">
                  <div className="p-8 border-b border-slate-100 dark:border-zinc-800">
                    <h2 className="text-xl font-bold mb-1 tracking-tight">Providers</h2>
                    <p className="text-sm text-slate-500 dark:text-zinc-400">Configure AI providers and endpoints</p>
                  </div>
                  
                  <div className="p-8 space-y-8">
                    <ProviderManager 
                      providers={providers} 
                      onAdd={addProvider} 
                      onUpdate={updateProvider}
                      onRemove={removeProvider} 
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'api' && (
              <div className="max-w-3xl mx-auto py-12 px-6 w-full">
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 overflow-hidden shadow-xl shadow-slate-200/50 dark:shadow-none">
                  <div className="p-8 border-b border-slate-100 dark:border-zinc-800">
                    <h2 className="text-xl font-bold mb-1 tracking-tight">API Configuration</h2>
                  </div>
                  
                  <div className="p-8 space-y-8">
                    <KeyManager apiKeys={apiKeys} onAdd={addApiKey} onRemove={removeApiKey} modelName={modelName} providerName={providers.find(p => p.id === activeProviderId)?.name || activeProviderId || 'default'} />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'groups' && !selectedGroupSlug && (
              <div className="max-w-3xl mx-auto py-12 px-6 w-full">
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 overflow-hidden shadow-xl transition-all">
                  <div className="p-8 border-b border-slate-100 dark:border-zinc-800">
                    <h2 className="text-xl font-bold mb-1 tracking-tight">Groups</h2>
                    <p className="text-sm text-slate-500 dark:text-zinc-400">Groups you are a member of.</p>
                  </div>
                  <div className="p-8">
                    {groups.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <div className="w-12 h-12 bg-slate-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center mb-4">
                          <Users className="w-6 h-6 text-slate-400" />
                        </div>
                        <p className="text-sm text-slate-500 dark:text-zinc-500">You are not a member of any groups.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {groups.map(g => (
                          <div
                            key={g.id}
                            className={`p-5 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/50 flex items-center justify-between ${isAdmin ? 'cursor-pointer hover:border-indigo-500 dark:hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-colors' : ''}`}
                            onClick={() => isAdmin && openGroupDetail(g.id)}
                          >
                            <div className="flex items-center gap-3">
                              <Users className="w-5 h-5 text-slate-400" />
                              <span className="font-bold text-slate-700 dark:text-zinc-200">{g.name}</span>
                            </div>
                            {isAdmin && (
                              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">Manage</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'groups' && selectedGroupSlug && (
              <div className="max-w-5xl mx-auto py-12 px-6 w-full">
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 overflow-hidden shadow-xl transition-all">
                  <div className="p-8 border-b border-slate-100 dark:border-zinc-800">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button onClick={closeGroupDetail} className="flex items-center gap-1.5 px-3 py-1.5 -ml-2 text-sm font-bold text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl transition-colors">
                          <ChevronLeft className="w-4 h-4" /> Groups
                        </button>
                        <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                          <Users className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                          <h2 className="text-xl font-bold tracking-tight">{groupDetail?.name || selectedGroupSlug}</h2>
                          <p className="text-sm text-slate-500 dark:text-zinc-400">{groupDetail?.members.length || 0} members</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-8">
                    <div className="flex gap-6">
                      {/* Left: Member management */}
                      <div className="w-80 flex-shrink-0 space-y-6">
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500 mb-3">Add Member</h3>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={addUserSearch}
                              onChange={(e) => setAddUserSearch(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMemberByEmail(); } }}
                              placeholder="Email address..."
                              className="flex-1 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-2xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400"
                            />
                            <button
                              onClick={addMemberByEmail}
                              className="w-10 h-10 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500 mb-3">Members</h3>
                          <div className="flex gap-2 mb-3">
                            <input
                              type="text"
                              value={memberSearch}
                              onChange={(e) => setMemberSearch(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchMembers(); } }}
                              placeholder="Search members..."
                              className="flex-1 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-2xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400"
                            />
                            <button
                              onClick={searchMembers}
                              className="w-10 h-10 bg-slate-200 dark:bg-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-600 text-slate-600 dark:text-zinc-300 rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
                            >
                              <Search className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                            {memberResults.length === 0 ? (
                              <p className="text-xs text-slate-400 p-2">No members found.</p>
                            ) : (
                              memberResults.map(m => (
                                <button
                                  key={m.id}
                                  onClick={() => selectMember(m.id)}
                                  className={`w-full text-left p-2.5 rounded-xl text-sm font-medium transition-colors ${
                                    selectedMemberId === m.id
                                      ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400'
                                      : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800'
                                  }`}
                                >
                                  {m.name}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Member details */}
                      <div className="flex-1 border-l border-slate-200 dark:border-zinc-800 pl-6">
                        {!selectedMemberData ? (
                          <div className="flex flex-col items-center justify-center py-16 text-center">
                            <div className="w-12 h-12 bg-slate-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center mb-4">
                              <Users className="w-6 h-6 text-slate-400" />
                            </div>
                            <p className="text-sm text-slate-500 dark:text-zinc-500">Select a member to manage their resources.</p>
                          </div>
                        ) : (
                          <div className="space-y-6">
                            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-zinc-800/50 rounded-2xl">
                              <div>
                                <h3 className="font-bold text-slate-700 dark:text-zinc-200">{selectedMemberData.user.name}</h3>
                                <p className="text-[10px] font-mono text-slate-400">{selectedMemberData.user.id}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => selectedGroupSlug && removeMemberFromGroup(selectedMemberData.user.id)}
                                  className="px-4 py-2 bg-slate-200 dark:bg-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-600 text-slate-700 dark:text-zinc-200 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                                >
                                  <X className="w-3.5 h-3.5" /> Remove from Group
                                </button>
                                <button
                                  onClick={() => adminDeleteUser(selectedMemberData.user.id)}
                                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Delete User
                                </button>
                              </div>
                            </div>

                            <div>
                              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 mb-2">Providers</h4>
                              {selectedMemberData.providers.length === 0 ? (
                                <p className="text-xs text-slate-400">None</p>
                              ) : (
                                <div className="rounded-xl border border-slate-200 dark:border-zinc-700 overflow-hidden">
                                  <div className="flex items-center px-4 py-2 bg-slate-100 dark:bg-zinc-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                                    <span className="flex-1">Provider</span>
                                    <span className="flex-1">Models</span>
                                    <span className="w-8" />
                                  </div>
                                  {selectedMemberData.providers.map(p => (
                                    <div key={p.id} className="flex items-center px-4 py-2.5 border-t border-slate-100 dark:border-zinc-800 text-sm">
                                      <span className="flex-1 font-mono text-xs text-slate-600 dark:text-zinc-400 truncate">{p.base_url}</span>
                                      <span className="flex-1 flex flex-wrap gap-1">
                                        {p.models.split(',').map((m, i) => (
                                          <span key={i} className="text-[11px] font-mono bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 px-2 py-0.5 rounded-full">{m.trim()}</span>
                                        ))}
                                      </span>
                                      <span className="w-8 flex justify-end">
                                        <button
                                          onClick={() => adminDeleteProvider(selectedMemberData.user.id, p.id)}
                                          className="p-1 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-500 rounded-lg transition-colors"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div>
                              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 mb-2">Usage</h4>
                              {selectedMemberUsage.length === 0 ? (
                                <p className="text-xs text-slate-400">No usage data.</p>
                              ) : (() => {
                                const months: { label: string; cost: number }[] = [];
                                const now = new Date();
                                for (let i = 0; i < 3; i++) {
                                  const year = now.getFullYear();
                                  const month = now.getMonth() - i;
                                  const start = new Date(year, month, 1);
                                  const end = i === 0 ? now : new Date(year, month + 1, 0, 23, 59, 59);
                                  const cost = selectedMemberUsage
                                    .filter(ev => {
                                      const d = new Date(ev.timestamp * 1000);
                                      return d >= start && d <= end;
                                    })
                                    .reduce((sum, ev) => sum + ev.total_cost, 0);
                                  const fmtStart = `${start.getMonth() + 1}/${start.getDate()}/${String(start.getFullYear()).slice(2)}`;
                                  const fmtEnd = i === 0 ? 'Today' : `${end.getMonth() + 1}/${end.getDate()}/${String(end.getFullYear()).slice(2)}`;
                                  months.push({ label: `${fmtStart} - ${fmtEnd}`, cost });
                                }
                                return (
                                  <div className="rounded-xl border border-slate-200 dark:border-zinc-700 overflow-hidden">
                                    <div className="flex items-center px-4 py-2 bg-slate-100 dark:bg-zinc-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                                      <span className="flex-1">Date Range</span>
                                      <span className="w-24 text-right">Cost</span>
                                    </div>
                                    {months.map((m, i) => (
                                      <div key={i} className="flex items-center px-4 py-2.5 border-t border-slate-100 dark:border-zinc-800 text-sm">
                                        <span className="flex-1 font-mono text-xs text-slate-600 dark:text-zinc-300">{m.label}</span>
                                        <span className="w-24 text-right font-mono text-xs text-slate-500 dark:text-zinc-400">${m.cost.toFixed(6)}</span>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="max-w-5xl mx-auto py-12 px-6 w-full">
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 overflow-hidden shadow-xl transition-all">
                  <div className="p-8 border-b border-slate-100 dark:border-zinc-800">
                    <h2 className="text-xl font-bold mb-1 tracking-tight">Settings</h2>
                  </div>
                  <div className="p-8 space-y-6">
                    {activeIdentity?.type === 'group' && (
                      <div className="border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
                        <div className="p-5 bg-slate-50 dark:bg-zinc-800/50 border-b border-slate-200 dark:border-zinc-800">
                          <h3 className="font-bold text-[15px]">Group: {groupDetail?.name || activeIdentity.id}</h3>
                          <p className="text-xs text-slate-500 dark:text-zinc-400">{groupDetail?.members.length || 0} members</p>
                        </div>
                        <div className="p-5">
                          <div className="flex gap-6">
                            <div className="w-64 flex-shrink-0 space-y-6">
                              <div>
                                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500 mb-3">Add Member</h4>
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={addUserSearch}
                                    onChange={(e) => setAddUserSearch(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMemberByEmail(); } }}
                                    placeholder="Email address..."
                                    className="flex-1 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-2xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400"
                                  />
                                  <button
                                    onClick={addMemberByEmail}
                                    className="w-10 h-10 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
                                  >
                                    <Plus className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                              <div>
                                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500 mb-3">Members</h4>
                                <div className="flex gap-2 mb-3">
                                  <input
                                    type="text"
                                    value={memberSearch}
                                    onChange={(e) => setMemberSearch(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchMembers(); } }}
                                    placeholder="Search members..."
                                    className="flex-1 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-2xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400"
                                  />
                                  <button
                                    onClick={searchMembers}
                                    className="w-10 h-10 bg-slate-200 dark:bg-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-600 text-slate-600 dark:text-zinc-300 rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
                                  >
                                    <Search className="w-4 h-4" />
                                  </button>
                                </div>
                                <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                                  {memberResults.length === 0 ? (
                                    <p className="text-xs text-slate-400 p-2">No members found.</p>
                                  ) : (
                                    memberResults.map(m => (
                                      <button
                                        key={m.id}
                                        onClick={() => selectMember(m.id)}
                                        className={`w-full text-left p-2.5 rounded-xl text-sm font-medium transition-colors ${
                                          selectedMemberId === m.id
                                            ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400'
                                            : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800'
                                        }`}
                                      >
                                        {m.name}
                                      </button>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex-1 min-w-0 border-l border-slate-200 dark:border-zinc-800 pl-6">
                              {!selectedMemberData ? (
                                <div className="flex flex-col items-center justify-center py-16 text-center">
                                  <div className="w-12 h-12 bg-slate-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center mb-4">
                                    <Users className="w-6 h-6 text-slate-400" />
                                  </div>
                                  <p className="text-sm text-slate-500 dark:text-zinc-500">Select a member.</p>
                                </div>
                              ) : (
                                <div className="space-y-6">
                                  <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-zinc-800/50 rounded-2xl">
                                    <div>
                                      <h3 className="font-bold text-slate-700 dark:text-zinc-200">{selectedMemberData.user.name}</h3>
                                      <p className="text-[10px] font-mono text-slate-400">{selectedMemberData.user.id}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => selectedGroupSlug && removeMemberFromGroup(selectedMemberData.user.id)}
                                        className="px-4 py-2 bg-slate-200 dark:bg-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-600 text-slate-700 dark:text-zinc-200 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                                      >
                                        <X className="w-3.5 h-3.5" /> Remove
                                      </button>
                                      <button
                                        onClick={() => adminDeleteUser(selectedMemberData.user.id)}
                                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" /> Delete
                                      </button>
                                    </div>
                                  </div>
                                  <div>
                                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 mb-2">API Keys</h4>
                                    {selectedMemberData.keys.length === 0 ? (
                                      <p className="text-xs text-slate-400">None</p>
                                    ) : (
                                      <div className="space-y-1">
                                        {selectedMemberData.keys.map(k => (
                                          <div key={k.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-zinc-800/50 text-xs">
                                            <span className="font-mono text-slate-600 dark:text-zinc-400">{k.name} ({k.prefix}...)</span>
                                            <button onClick={() => adminDeleteKey(selectedMemberData.user.id, k.id)} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded"><Trash2 className="w-3 h-3" /></button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 mb-2">Providers</h4>
                                    {selectedMemberData.providers.length === 0 ? (
                                      <p className="text-xs text-slate-400">None</p>
                                    ) : (
                                      <div className="space-y-1">
                                        {selectedMemberData.providers.map(p => (
                                          <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-zinc-800/50 text-xs">
                                            <span className="font-mono text-slate-600 dark:text-zinc-400">{p.name}</span>
                                            <button onClick={() => adminDeleteProvider(selectedMemberData.user.id, p.id)} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded"><Trash2 className="w-3 h-3" /></button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 mb-2">Usage</h4>
                                    {selectedMemberUsage.length === 0 ? (
                                      <p className="text-xs text-slate-400">No usage data.</p>
                                    ) : (() => {
                                      const months: { label: string; cost: number }[] = [];
                                      const now = new Date();
                                      for (let i = 0; i < 3; i++) {
                                        const year = now.getFullYear();
                                        const month = now.getMonth() - i;
                                        const start = new Date(year, month, 1);
                                        const end = i === 0 ? now : new Date(year, month + 1, 0, 23, 59, 59);
                                        const cost = selectedMemberUsage
                                          .filter((ev: UsageEvent) => {
                                            const d = new Date(ev.timestamp * 1000);
                                            return d >= start && d <= end;
                                          })
                                          .reduce((sum: number, ev: UsageEvent) => sum + ev.total_cost, 0);
                                        const fmtStart = `${start.getMonth() + 1}/${start.getDate()}/${String(start.getFullYear()).slice(2)}`;
                                        const fmtEnd = i === 0 ? 'Today' : `${end.getMonth() + 1}/${end.getDate()}/${String(end.getFullYear()).slice(2)}`;
                                        months.push({ label: `${fmtStart} - ${fmtEnd}`, cost });
                                      }
                                      return (
                                        <div className="rounded-xl border border-slate-200 dark:border-zinc-700 overflow-hidden">
                                          <div className="flex items-center px-4 py-2 bg-slate-100 dark:bg-zinc-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                                            <span className="flex-1">Date Range</span>
                                            <span className="w-24 text-right">Cost</span>
                                          </div>
                                          {months.map((m, i) => (
                                            <div key={i} className="flex items-center px-4 py-2.5 border-t border-slate-100 dark:border-zinc-800 text-sm">
                                              <span className="flex-1 font-mono text-xs text-slate-600 dark:text-zinc-300">{m.label}</span>
                                              <span className="w-24 text-right font-mono text-xs text-slate-500 dark:text-zinc-400">${m.cost.toFixed(6)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between p-5 bg-slate-50 dark:bg-zinc-800/50 rounded-2xl border border-slate-100 dark:border-zinc-800">
                      <div>
                        <h3 className="font-bold text-[15px]">Advanced Telemetry</h3>
                        <p className="text-xs text-slate-500 dark:text-zinc-400">Show extra information in the chat dialogue like token usage and request id</p>
                      </div>
                      <ToggleButton active={preferences.advancedTelemetry} onToggle={() => updatePreference('advancedTelemetry', !preferences.advancedTelemetry)} />
                    </div>
                    <div className="border-t border-slate-200 dark:border-zinc-800 pt-6">
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="w-full bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-bold shadow-lg shadow-red-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                      >
                        <Trash2 className="w-5 h-5" /> Delete Account
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'usage' && (
              <div className="max-w-5xl mx-auto py-12 px-6 w-full">
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 overflow-hidden shadow-xl transition-all">
                  <div className="p-8 border-b border-slate-100 dark:border-zinc-800">
                    <h2 className="text-xl font-bold mb-1 tracking-tight">Usage</h2>
                    <p className="text-sm text-slate-500 dark:text-zinc-400">API usage and cost breakdown.</p>
                  </div>
                  <div className="p-8">
                    {usageEvents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <p className="text-sm text-slate-500 dark:text-zinc-500 mt-2">No usage data yet.</p>
                      </div>
                    ) : (() => {
                      const months = new Map<string, UsageEvent[]>();
                      for (const ev of usageEvents) {
                        const d = new Date(ev.timestamp * 1000);
                        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                        if (!months.has(key)) months.set(key, []);
                        months.get(key)!.push(ev);
                      }
                      const sortedMonths = Array.from(months.entries()).sort((a, b) => b[0].localeCompare(a[0]));
                      const itemsPerPage = 3;
                      const totalPages = Math.ceil(sortedMonths.length / itemsPerPage);
                      const pageMonths = sortedMonths.slice(monthPage * itemsPerPage, (monthPage + 1) * itemsPerPage);

                      const toggleMonth = (key: string) => {
                        setExpandedMonths(prev => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                      };

                      const monthLabel = (key: string) => {
                        const [y, m] = key.split('-');
                        const date = new Date(parseInt(y), parseInt(m) - 1);
                        return date.toLocaleString('default', { month: 'short', year: '2-digit' });
                      };

                      return (
                        <>
                          {totalPages > 1 && (
                            <div className="flex items-center justify-center gap-4 mb-6">
                              <button
                                onClick={() => setMonthPage(p => Math.max(0, p - 1))}
                                disabled={monthPage === 0}
                                className="px-3 py-1.5 text-sm font-bold rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                              >
                                Previous
                              </button>
                              <span className="text-sm font-bold text-slate-500 dark:text-zinc-400">
                                {monthPage + 1} / {totalPages}
                              </span>
                              <button
                                onClick={() => setMonthPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={monthPage >= totalPages - 1}
                                className="px-3 py-1.5 text-sm font-bold rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                              >
                                Next
                              </button>
                            </div>
                          )}
                          {pageMonths.map(([monthKey, events]) => {
                            const isExpanded = expandedMonths.has(monthKey);
                            const monthTotal = events.reduce((sum, ev) => sum + ev.total_cost, 0);
                            return (
                              <div key={monthKey} className="mb-4 border border-slate-200 dark:border-zinc-700 rounded-2xl overflow-hidden">
                                <button
                                  onClick={() => toggleMonth(monthKey)}
                                  className="w-full flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors text-left"
                                >
                                  <span className="font-bold text-sm text-slate-700 dark:text-zinc-200">
                                    {monthLabel(monthKey)}
                                  </span>
                                  <span className="text-xs font-mono text-slate-500 dark:text-zinc-400 mr-3">${monthTotal.toFixed(9)}</span>
                                  <span className="text-slate-400 dark:text-zinc-500 text-xs font-mono mr-2">{events.length} requests</span>
                                  <span className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                                    <ChevronDown className="w-4 h-4 text-slate-400" />
                                  </span>
                                </button>
                                {isExpanded && (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="border-b border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                                          <th className="text-left py-3 px-2 font-bold text-slate-500 dark:text-zinc-400 text-[11px] uppercase tracking-wider">Date</th>
                                          <th className="text-left py-3 px-2 font-bold text-slate-500 dark:text-zinc-400 text-[11px] uppercase tracking-wider">API Key</th>
                                          <th className="text-left py-3 px-2 font-bold text-slate-500 dark:text-zinc-400 text-[11px] uppercase tracking-wider">Provider</th>
                                          <th className="text-left py-3 px-2 font-bold text-slate-500 dark:text-zinc-400 text-[11px] uppercase tracking-wider">Model</th>
                                          <th className="text-right py-3 px-2 font-bold text-slate-500 dark:text-zinc-400 text-[11px] uppercase tracking-wider">Source</th>
                                          <th className="text-right py-3 px-2 font-bold text-slate-500 dark:text-zinc-400 text-[11px] uppercase tracking-wider">In</th>
                                          <th className="text-right py-3 px-2 font-bold text-slate-500 dark:text-zinc-400 text-[11px] uppercase tracking-wider">Out</th>
                                          <th className="text-right py-3 px-2 font-bold text-slate-500 dark:text-zinc-400 text-[11px] uppercase tracking-wider">Req</th>
                                              <th className="text-right py-3 px-2 font-bold text-slate-500 dark:text-zinc-400 text-[11px] uppercase tracking-wider">In × Price</th>
                                              <th className="text-right py-3 px-2 font-bold text-slate-500 dark:text-zinc-400 text-[11px] uppercase tracking-wider">Out × Price</th>
                                              <th className="text-right py-3 px-2 font-bold text-slate-500 dark:text-zinc-400 text-[11px] uppercase tracking-wider">Total Cost</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {events.map((ev) => (
                                          <tr key={ev.id} className="border-b border-slate-100 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/50">
                                            <td className="py-3 px-2 text-slate-600 dark:text-zinc-300 font-mono text-[12px]">
                                              {new Date(ev.timestamp * 1000).toLocaleString()}
                                            </td>
                                            <td className="py-3 px-2 text-slate-600 dark:text-zinc-300 font-mono text-[12px]">
                                              {ev.api_key_prefix}...
                                            </td>
                                            <td className="py-3 px-2 text-slate-600 dark:text-zinc-300 font-medium text-[12px]">
                                              {ev.provider_name}
                                            </td>
                                            <td className="py-3 px-2 text-slate-600 dark:text-zinc-300 font-mono text-[12px]">
                                              {ev.model_id}
                                            </td>
                                            <td className="py-3 px-2 text-slate-600 dark:text-zinc-300 font-mono text-[12px] text-right">
                                              {ev.source}
                                            </td>
                                            <td className="py-3 px-2 text-slate-600 dark:text-zinc-300 font-mono text-[12px] text-right">
                                              {ev.input_tokens.toLocaleString()}
                                            </td>
                                            <td className="py-3 px-2 text-slate-600 dark:text-zinc-300 font-mono text-[12px] text-right">
                                              {ev.output_tokens.toLocaleString()}
                                            </td>
                                            <td className="py-3 px-2 text-slate-600 dark:text-zinc-300 font-mono text-[12px] text-right">
                                              1
                                            </td>
                                            <td className="py-3 px-2 text-slate-600 dark:text-zinc-300 font-mono text-[12px] text-right">
                                              {ev.input_tokens.toLocaleString()} × ${ev.input_cost_per_1m_tokens.toFixed(4)}
                                </td>
                                <td className="py-3 px-2 text-slate-600 dark:text-zinc-300 font-mono text-[12px] text-right">
                                              {ev.output_tokens.toLocaleString()} × ${ev.output_cost_per_1m_tokens.toFixed(4)}
                                </td>
                                <td className="py-3 px-2 font-mono text-[12px] text-right font-bold text-slate-700 dark:text-zinc-200">
                                  ${ev.total_cost.toFixed(9)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'deployments' && (
              <div className="max-w-3xl mx-auto py-12 px-6 w-full">
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 overflow-hidden shadow-xl transition-all">
                  <div className="p-8 border-b border-slate-100 dark:border-zinc-800">
                    <h2 className="text-xl font-bold mb-1 tracking-tight">Deployments</h2>
                    <p className="text-sm text-slate-500 dark:text-zinc-400">Manage your model deployments.</p>
                  </div>
                  <div className="p-8 space-y-8">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500 mb-4">New Deployment</h3>
                      <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 p-6">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Name</label>
                            <input
                              type="text"
                              value={newDeployName}
                              onChange={(e) => setNewDeployName(e.target.value)}
                              placeholder="my-deployment"
                              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Image</label>
                            <select
                              value={newDeployImage}
                              onChange={(e) => setNewDeployImage(e.target.value)}
                              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                            >
                              {DEPLOY_IMAGES.map(img => (
                                <option key={img} value={img}>{img}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Model</label>
                            <input
                              type="text"
                              value={newDeployModel}
                              onChange={(e) => setNewDeployModel(e.target.value)}
                              placeholder="hf:// ollama:// s3://"
                              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Location</label>
                            <select
                              value={newDeployLocation}
                              onChange={(e) => setNewDeployLocation(e.target.value)}
                              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                            >
                              <option value="local">local</option>
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Type of GPU</label>
                            <select
                              value={newDeployGpuType}
                              onChange={(e) => setNewDeployGpuType(e.target.value)}
                              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                            >
                              {DEPLOY_GPU_TYPES.map(g => (
                                <option key={g} value={g}>{g}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Number of GPUs</label>
                            <input
                              type="number"
                              value={newDeployNumGpus}
                              onChange={(e) => setNewDeployNumGpus(parseInt(e.target.value, 10) || 0)}
                              min={0}
                              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Minimum Replicas</label>
                            <input
                              type="number"
                              value={newDeployMin}
                              onChange={(e) => setNewDeployMin(parseInt(e.target.value, 10) || 0)}
                              min={0}
                              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Maximum Replicas</label>
                            <input
                              type="number"
                              value={newDeployMax}
                              onChange={(e) => setNewDeployMax(parseInt(e.target.value, 10) || 1)}
                              min={1}
                              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Host CPUs</label>
                            <input
                              type="number"
                              value={newDeployHostCpus}
                              onChange={(e) => setNewDeployHostCpus(parseInt(e.target.value, 10) || 1)}
                              min={1}
                              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Host Memory</label>
                            <input
                              type="text"
                              value={newDeployHostMemory}
                              onChange={(e) => setNewDeployHostMemory(e.target.value)}
                              placeholder="8Gi"
                              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400"
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (!newDeployName.trim()) return;
                            setDeployments(prev => [...prev, {
                              id: genId(),
                              name: newDeployName.trim(),
                              image: newDeployImage,
                              model: newDeployModel.trim() || 'hf://default',
                              minReplicas: newDeployMin,
                              maxReplicas: newDeployMax,
                              currentReplicas: 0,
                              location: newDeployLocation,
                              gpuType: newDeployGpuType,
                              numGpus: newDeployNumGpus,
                              hostCpus: newDeployHostCpus,
                              hostMemory: newDeployHostMemory,
                            }]);
                            setNewDeployName('');
                            setNewDeployModel('');
                            setNewDeployMin(0);
                            setNewDeployMax(1);
                            setNewDeployNumGpus(0);
                            setNewDeployHostCpus(2);
                            setNewDeployHostMemory('8Gi');
                          }}
                          disabled={!newDeployName.trim() || deployments.length >= 5}
                          className="w-full mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-zinc-700 text-white py-3 rounded-2xl font-bold shadow-lg shadow-indigo-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                        >
                          <Plus className="w-4 h-4" /> {deployments.length >= 5 ? 'Limit Reached (5)' : 'Create Deployment'}
                        </button>
                      </div>
                    </div>

                    <div className="pt-6 border-t border-slate-100 dark:border-zinc-800">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500 mb-4">Deployments</h3>
                      {deployments.length === 0 ? (
                        <div className="p-8 text-center border-2 border-dashed border-slate-100 dark:border-zinc-800 rounded-3xl text-slate-400">
                          No deployments yet.
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-slate-50 dark:bg-zinc-800/50 border-b border-slate-200 dark:border-zinc-800">
                                <th className="text-left p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Name</th>
                                <th className="text-center p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Min</th>
                                <th className="text-center p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Max</th>
                                <th className="text-center p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Current</th>
                                <th className="text-center p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Status</th>
                                <th className="text-right p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {deployments.map(d => (
                                <tr key={d.id} className="border-b border-slate-100 dark:border-zinc-800 last:border-b-0 hover:bg-slate-50 dark:hover:bg-zinc-800/30 transition-colors">
                                  <td className="p-4 font-bold text-slate-700 dark:text-zinc-200">{d.name}</td>
                                  <td className="p-4 text-center font-mono text-xs text-slate-500 dark:text-zinc-400">{d.minReplicas}</td>
                                  <td className="p-4 text-center font-mono text-xs text-slate-500 dark:text-zinc-400">{d.maxReplicas}</td>
                                  <td className="p-4 text-center font-mono text-xs text-slate-500 dark:text-zinc-400">{d.currentReplicas}</td>
                                  <td className="p-4 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
                                      <span className="text-xs font-mono text-slate-500 dark:text-zinc-400">ok</span>
                                    </div>
                                  </td>
                                  <td className="p-4 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <button
                                        onClick={() => {
                                          setEditDeployData(d);
                                          setEditName(d.name);
                                          setEditImage(d.image);
                                          setEditModel(d.model);
                                          setEditMin(d.minReplicas);
                                          setEditMax(d.maxReplicas);
                                          setEditLocation(d.location);
                                          setEditGpuType(d.gpuType);
                                          setEditNumGpus(d.numGpus);
                                          setEditHostCpus(d.hostCpus);
                                          setEditHostMemory(d.hostMemory);
                                        }}
                                        className="p-2 hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-500 rounded-xl transition-colors"
                                      >
                                        <Pencil className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => setDeployments(prev => prev.filter(x => x.id !== d.id))}
                                        className="p-2 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-500 rounded-xl transition-colors"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
        </div>

        {/* Input Dock */}
        {activeTab === 'chat' && (
          <div className="absolute bottom-0 left-0 right-0 p-6 pointer-events-none">
            <div className="max-w-4xl mx-auto w-full pointer-events-auto">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-2xl blur opacity-25 group-focus-within:opacity-50 transition duration-500" />
                <div className="relative bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-2xl flex items-end p-2 pl-4">
                  {overLimit && (
                    <div className="absolute bottom-full left-0 right-0 mb-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                      <span className="font-semibold">Context limit reached.</span>
                      <span>Clear the chat to continue. ({currentTokens.toLocaleString()} / {MAX_INPUT_TOKENS.toLocaleString()} tokens)</span>
                    </div>
                  )}
                  <textarea 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={overLimit ? "Context limit reached — clear chat to continue" : "Message..."}
                    className="flex-1 bg-transparent border-none outline-none focus:ring-0 resize-none py-3.5 h-12 min-h-[54px] max-h-48 text-[15px] leading-relaxed text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:placeholder:text-transparent transition-[color]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                  />
                  <div className="flex gap-2 p-1.5 pt-0">
                    <button 
                      onClick={handleSendMessage}
                      aria-label="Send"
                      disabled={!input.trim() || isTyping || overLimit}
                      className="w-11 h-11 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-100 dark:disabled:bg-zinc-800 text-white disabled:text-slate-400 rounded-xl flex items-center justify-center transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Delete Account Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-bold">Delete Account</h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-zinc-400 mb-2">
              This action is permanent and cannot be undone. All your data including messages, API keys, and providers will be deleted.
            </p>
            <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
              Type your email <strong className="text-slate-700 dark:text-zinc-200">{currentUser}</strong> to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirmEmail}
              onChange={(e) => setDeleteConfirmEmail(e.target.value)}
              placeholder={currentUser}
              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-2xl p-4 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-red-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-zinc-600 mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmEmail(''); }}
                className="flex-1 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 py-3 rounded-2xl font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={deleteAccount}
                disabled={deleteConfirmEmail !== currentUser}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:bg-red-300 dark:disabled:bg-red-900 disabled:cursor-not-allowed text-white py-3 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Delete Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Key Modal - shows after creating a key */}
      {showNewKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Check className="w-5 h-5 text-green-600" />
              </div>
              <h3 className="text-lg font-bold">Key Created</h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
              Copy your API key now. You won't be able to see it again!
            </p>
            <div className="bg-slate-100 dark:bg-zinc-800 rounded-2xl p-4 font-mono text-sm break-all mb-4">
              {showNewKey}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  copyToClipboard(showNewKey);
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-2xl font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Copy className="w-4 h-4" /> Copy Key
              </button>
              <button
                onClick={() => setShowNewKey(null)}
                className="px-6 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 py-3 rounded-2xl font-bold transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Deployment Modal */}
      {editDeployData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                <Pencil className="w-5 h-5 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold">Edit Deployment</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="my-deployment"
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Image</label>
                <select
                  value={editImage}
                  onChange={(e) => setEditImage(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                >
                  {DEPLOY_IMAGES.map(img => (
                    <option key={img} value={img}>{img}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Model</label>
                <input
                  type="text"
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                  placeholder="hf://model"
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Location</label>
                <select
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                >
                  <option value="local">local</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Type of GPU</label>
                <select
                  value={editGpuType}
                  onChange={(e) => setEditGpuType(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                >
                  {DEPLOY_GPU_TYPES.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Number of GPUs</label>
                <input
                  type="number"
                  value={editNumGpus}
                  onChange={(e) => setEditNumGpus(parseInt(e.target.value, 10) || 0)}
                  min={0}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Minimum Replicas</label>
                <input
                  type="number"
                  value={editMin}
                  onChange={(e) => setEditMin(parseInt(e.target.value, 10) || 0)}
                  min={0}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Maximum Replicas</label>
                <input
                  type="number"
                  value={editMax}
                  onChange={(e) => setEditMax(parseInt(e.target.value, 10) || 1)}
                  min={1}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Host CPUs</label>
                <input
                  type="number"
                  value={editHostCpus}
                  onChange={(e) => setEditHostCpus(parseInt(e.target.value, 10) || 1)}
                  min={1}
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Host Memory</label>
                <input
                  type="text"
                  value={editHostMemory}
                  onChange={(e) => setEditHostMemory(e.target.value)}
                  placeholder="8Gi"
                  className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditDeployData(null)}
                className="flex-1 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 py-3 rounded-2xl font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!editName.trim() || !editDeployData) return;
                  setDeployments(prev => prev.map(d => d.id === editDeployData.id ? {
                    ...d,
                    name: editName.trim(),
                    image: editImage,
                    model: editModel.trim() || 'hf://default',
                    minReplicas: editMin,
                    maxReplicas: editMax,
                    location: editLocation,
                    gpuType: editGpuType,
                    numGpus: editNumGpus,
                    hostCpus: editHostCpus,
                    hostMemory: editHostMemory,
                  } : d));
                  setEditDeployData(null);
                }}
                disabled={!editName.trim()}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-zinc-700 text-white py-3 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> Save
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </ErrorBoundary>
  );
}

// --- Subcomponents ---

function SidebarButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-2xl transition-all duration-200 group ${
        active 
          ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 shadow-sm' 
          : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800'
      }`}
    >
      <div className={`p-1.5 rounded-lg transition-colors ${active ? 'bg-indigo-100 dark:bg-indigo-500/20' : 'bg-slate-100 dark:bg-zinc-800 shadow-sm'}`}>
        {icon}
      </div>
      {label}
    </button>
  );
}

// Render message content with Markdown support
function renderMessageContent(content: string): React.ReactNode {
  if (!content) return null;
  
  const handleCopy = (code: string) => {
    copyToClipboard(code);
  };
  
  // Helper to render inline formatting (bold, italic, inline code) within a line
  const renderInlineFormatting = (text: string): React.ReactNode => {
    // Split by code blocks first, then process each segment
    const segments: React.ReactNode[] = [];
    let lastIndex = 0;
    
    // Match inline code and formatting patterns
    const regex = /(`[^`]+`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_)/g;
    let match;
    let hasMatches = false;
    
    // Check if there are any matches first
    const testRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/;
    
    if (!testRegex.test(text)) {
      return text;
    }
    
    const parts: React.ReactNode[] = [];
    let currentIndex = 0;
    
    while ((match = regex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > currentIndex) {
        parts.push(text.slice(currentIndex, match.index));
      }
      
      const fullMatch = match[0];
      
      if (fullMatch.startsWith('`')) {
        // Inline code
        parts.push(
          <code key={match.index} className="px-1.5 py-0.5 mx-0.5 text-[13px] font-mono bg-slate-100 dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 rounded border border-slate-200 dark:border-zinc-700">
            {fullMatch.slice(1, -1)}
          </code>
        );
      } else if (fullMatch.startsWith('**')) {
        // Bold
        parts.push(
          <strong key={match.index} className="font-bold">
            {match[2]}
          </strong>
        );
      } else if (fullMatch.startsWith('*')) {
        // Italic
        parts.push(
          <em key={match.index} className="italic">
            {match[3]}
          </em>
        );
      } else if (fullMatch.startsWith('_')) {
        // Italic with underscores
        parts.push(
          <em key={match.index} className="italic">
            {match[4]}
          </em>
        );
      }
      
      currentIndex = match.index + fullMatch.length;
    }
    
    // Add remaining text
    if (currentIndex < text.length) {
      parts.push(text.slice(currentIndex));
    }
    
    return parts.length > 0 ? parts : text;
  };
  
  // Helper to check if a line is a Markdown table row
  const isTableRow = (line: string): boolean => {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
  };
  
  // Helper to check if a line is a table separator (e.g., |---|---|
  const isTableSeparator = (line: string): boolean => {
    const trimmed = line.trim();
    // Matches patterns like |---| or | :--- | or | :---: |
    return /^\|\s*[:\-]+\s*(\|\s*[:\-]+\s*)+\|?$/.test(trimmed);
  };
  
  // Helper to parse a table row into cells
  const parseTableRow = (line: string): string[] => {
    const trimmed = line.trim();
    // Remove leading/trailing pipes and split by pipe
    const cells = trimmed.split('|').filter((_, i, arr) => i !== 0 && i !== arr.length - 1);
    return cells.map(cell => cell.trim());
  };
  
  // Helper to render a table
  const renderTable = (lines: string[], startIdx: number): { table: React.ReactNode; endIdx: number } => {
    const tableLines: string[] = [];
    let idx = startIdx;
    let headerProcessed = false;
    
    // Collect table rows
    while (idx < lines.length) {
      const line = lines[idx].trim();
      if (isTableRow(line) || isTableSeparator(line)) {
        if (isTableSeparator(line)) {
          headerProcessed = true;
          idx++;
          continue;
        }
        tableLines.push(line);
        idx++;
      } else {
        break;
      }
    }
    
    if (tableLines.length === 0) {
      return { table: null, endIdx: startIdx };
    }
    
    // Parse header row
    const headerCells = parseTableRow(tableLines[0]);
    
    // Count columns based on header
    const colCount = headerCells.length;
    
    // Build table HTML
    const table = (
      <div className="my-4 overflow-x-auto">
        <table className="min-w-full border-collapse border border-slate-200 dark:border-zinc-700 text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-zinc-800">
              {headerCells.map((cell, i) => (
                <th key={i} className="border border-slate-200 dark:border-zinc-700 px-4 py-2 text-left font-semibold text-slate-700 dark:text-zinc-200">
                  {renderInlineFormatting(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableLines.slice(1).map((row, rowIdx) => {
              const cells = parseTableRow(row);
              // Skip if column count doesn't match
              if (cells.length !== colCount) {
                // Treat as regular content
                return null;
              }
              return (
                <tr key={rowIdx} className={rowIdx % 2 === 0 ? 'bg-white dark:bg-zinc-900' : 'bg-slate-50/50 dark:bg-zinc-800/50'}>
                  {cells.map((cell, cellIdx) => (
                    <td key={cellIdx} className="border border-slate-200 dark:border-zinc-700 px-4 py-2 text-slate-600 dark:text-zinc-400">
                      {renderInlineFormatting(cell)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
    
    return { table, endIdx: idx };
  };
  
  // Helper to render a line based on its type
  const renderLine = (line: string, key: number): React.ReactNode => {
    const trimmed = line.trim();
    
    // H1: # Heading
    if (trimmed.startsWith('# ')) {
      return <h1 key={key} className="text-xl font-bold mt-4 mb-2 first:mt-0">{renderInlineFormatting(trimmed.slice(2))}</h1>;
    }
    // H2: ## Heading
    if (trimmed.startsWith('## ')) {
      return <h2 key={key} className="text-lg font-bold mt-4 mb-2 first:mt-0">{renderInlineFormatting(trimmed.slice(3))}</h2>;
    }
    // H3: ### Heading
    if (trimmed.startsWith('### ')) {
      return <h3 key={key} className="text-base font-bold mt-3 mb-1.5 first:mt-0">{renderInlineFormatting(trimmed.slice(4))}</h3>;
    }
    // H4: #### Heading
    if (trimmed.startsWith('#### ')) {
      return <h4 key={key} className="text-sm font-bold mt-3 mb-1 first:mt-0">{renderInlineFormatting(trimmed.slice(5))}</h4>;
    }
    // Unordered list item
    if (trimmed.match(/^[-*]\s/)) {
      return <li key={key} className="ml-4 list-disc list-inside">{renderInlineFormatting(trimmed.slice(2))}</li>;
    }
    // Ordered list item
    if (trimmed.match(/^\d+\.\s/)) {
      return <li key={key} className="ml-4 list-decimal list-inside">{renderInlineFormatting(trimmed.replace(/^\d+\.\s/, ''))}</li>;
    }
    // Blockquote
    if (trimmed.startsWith('> ')) {
      return <blockquote key={key} className="border-l-4 border-slate-300 dark:border-zinc-600 pl-4 italic text-slate-600 dark:text-zinc-400 my-2">{renderInlineFormatting(trimmed.slice(2))}</blockquote>;
    }
    // Empty line
    if (trimmed === '') {
      return <div key={key} className="h-2" />;
    }
    // Regular paragraph with inline formatting
    return <p key={key} className="my-1">{renderInlineFormatting(line)}</p>;
  };
  
  // Split content by code blocks first
  const parts = content.split(/(```(?:\w+)?\n[\s\S]*?```)/g);
  
  return parts.map((part, i) => {
    const codeMatch = part.match(/^```(?:(\w+))?\n?([\s\S]*?)```$/);
    if (codeMatch) {
      const language = codeMatch[1] || '';
      const code = codeMatch[2].trim();
      return (
        <div key={i} className="my-3 rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-800 bg-slate-900 dark:bg-black">
          <div className="flex items-center justify-between px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-slate-800 dark:bg-zinc-900 border-b border-slate-700 dark:border-zinc-800">
            <span className="text-slate-400 dark:text-zinc-500">{language || 'code'}</span>
            <button
              onClick={() => handleCopy(code)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-200 dark:text-zinc-500 dark:hover:text-zinc-300 hover:bg-slate-700 dark:hover:bg-zinc-700 rounded transition-colors"
            >
              <Copy className="w-3 h-3" /> Copy
            </button>
          </div>
          <pre className="p-4 overflow-x-auto">
            <code className="text-[13px] font-mono text-slate-100 dark:text-zinc-200 whitespace-pre-wrap break-words">
              {code}
            </code>
          </pre>
        </div>
      );
    }
    
    // For non-code content, render line by line with Markdown support
    const lines = part.split('\n');
    const elements: React.ReactNode[] = [];
    let lineIdx = 0;
    
    while (lineIdx < lines.length) {
      const line = lines[lineIdx].trim();
      
      // Check if this is the start of a table
      if (isTableRow(line)) {
        const { table, endIdx } = renderTable(lines, lineIdx);
        if (table) {
          elements.push(<div key={`table-${lineIdx}`}>{table}</div>);
          lineIdx = endIdx;
          continue;
        }
      }
      
      elements.push(renderLine(lines[lineIdx], lineIdx));
      lineIdx++;
    }
    
    return <div key={i}>{elements}</div>;
  });
}

function ExamplePrompt({ label, onClick }: { label: string; onClick: (l: string) => void }) {
  return (
    <button 
      onClick={() => onClick(label)}
      className="text-left p-4 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl hover:border-indigo-500 dark:hover:border-indigo-400 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-all group"
    >
      <p className="text-sm font-semibold mb-1 flex items-center justify-between">
        {label}
        <Plus className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
      </p>
      <p className="text-[11px] text-slate-400 dark:text-zinc-500">Tap to populate prompt engine</p>
    </button>
  );
}

function MessageRow({ message, onToggleThought, userEmail, advancedTelemetry, appName, currentTokens }: { message: Message; onToggleThought: () => void; userEmail?: string; advancedTelemetry?: boolean; appName?: string; key?: string; currentTokens?: number }) {
  const isUser = message.role === 'user';
  
  return (
    <div className={`p-6 border-b border-slate-100 dark:border-zinc-900/50 transition-colors ${isUser ? 'bg-white dark:bg-zinc-950' : 'bg-slate-50/50 dark:bg-zinc-900/30'}`}>
      <div className="max-w-3xl mx-auto flex gap-6">
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md ${
          isUser 
            ? 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300' 
            : 'bg-indigo-600 text-white'
        }`}>
          {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
        </div>
        
        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex items-center justify-between">
             <span className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500">
               {isUser ? userEmail : appName}
             </span>
             <button onClick={() => copyToClipboard(message.content)} className="p-1 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded transition-colors text-slate-400">
                <Copy className="w-3.5 h-3.5" />
              </button>
          </div>

          {message.thinkingLines && message.thinkingLines.length > 0 && (
            <div className="border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 shadow-sm">
              <button 
                onClick={(e) => { e.stopPropagation(); onToggleThought(); }}
                className="w-full flex items-center justify-between p-3 px-4 text-xs font-bold text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Monitor className="w-3.5 h-3.5" /> 
                  Thinking
                  <span className="text-[10px] text-slate-400 dark:text-zinc-600 font-mono">
                    ({message.thinkingLines.length})
                  </span>
                </span>
                {message.isThoughtExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              
              {/* Show preview or full content */}
              {!message.isThoughtExpanded ? (
                <div className="px-4 pb-3 text-[11px] font-mono text-slate-500 dark:text-zinc-500 truncate">
                  {message.thinkingLines[message.thinkingLines.length - 1]}
                </div>
              ) : (
                <div className="p-4 pt-1 bg-slate-50 dark:bg-zinc-900 text-[11px] font-mono text-slate-600 dark:text-zinc-400 leading-relaxed border-t border-slate-100 dark:border-zinc-800 max-h-48 overflow-y-auto">
                  {message.thinkingLines.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="text-slate-800 dark:text-zinc-200 text-[15px] leading-relaxed font-medium space-y-4">
            {renderMessageContent(message.content)}
          </div>

          {/* Telemetry display for assistant messages */}
          {advancedTelemetry && message.outputTokens !== undefined && (
            <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 dark:text-zinc-500">
              <span>In: {message.inputTokens?.toLocaleString()}</span>
              <span className="text-slate-300 dark:text-zinc-700">|</span>
              <span>Out: {message.outputTokens?.toLocaleString()}</span>
              <span className="text-slate-300 dark:text-zinc-700">|</span>
              <span>{message.tokensPerSecond?.toFixed(0)} TPS</span>
              <span className="text-slate-300 dark:text-zinc-700">|</span>
              <span>Context: {currentTokens !== undefined ? ((currentTokens / MAX_INPUT_TOKENS) * 100).toFixed(1) : '0.0'}%</span>
              {message.ttft !== undefined && (
                <>
                  <span className="text-slate-300 dark:text-zinc-700">|</span>
                  <span>TTFT: {message.ttft}ms</span>
                </>
              )}
              {message.responseTime !== undefined && (
                <>
                  <span className="text-slate-300 dark:text-zinc-700">|</span>
                  <span>RT: {message.responseTime}ms</span>
                </>
              )}
              {message.requestId && (
                <>
                  <span className="text-slate-300 dark:text-zinc-700">|</span>
                  <span>ID: {message.requestId.slice(0, 8)}</span>
                </>
              )}
              {message.rateLimitWindows && message.rateLimitWindows.length > 0 && (
                <>
                  <span className="text-slate-300 dark:text-zinc-700">|</span>
                  <span>RL: {message.rateLimitWindows.map(w => `${w.limit - w.remaining}/${w.limit}/${w.unit}`).join(' ')}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KeyManager({ apiKeys, onAdd, onRemove, modelName, providerName }: { 
  apiKeys: ApiKey[]; 
  onAdd: (n: string) => Promise<string | null>; 
  onRemove: (id: string) => void;
  modelName: string;
  providerName: string;
}) {
  const [newName, setNewName] = useState('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const atLimit = apiKeys.length >= 5;

  const [requestFormat, setRequestFormat] = useState<'curl' | 'python'>('curl');

  const requestUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000';
  const sampleModel = modelName || 'default';
  const codeSamples = {
    curl: `curl ${requestUrl}/v1/chat/completions \\
    -H "Authorization: Bearer \$API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{
           "model":"${sampleModel}",
           "provider":"${providerName}",
           "messages":[{"role":"user","content":"Hi"}]
        }'`,
    python: `import requests

response = requests.post(
    f"${requestUrl}/v1/chat/completions",
    headers={
        "Authorization": "Bearer $API_KEY",
        "Content-Type": "application/json"
    },
    json={
        "model": "${sampleModel}",
        "provider": "${providerName}",
        "messages": [{"role": "user", "content": "Hi"}]
    }
)

print(response.json())`
  };

  const handleCopySample = () => {
    copyToClipboard(codeSamples[requestFormat]);
  };

  return (
    <div className="space-y-6">
      {/* Code Sample Section */}
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500">API Usage Example</h3>
      <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-zinc-800 bg-slate-900 dark:bg-black">
        <div className="flex items-center justify-between px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-wider bg-slate-800 dark:bg-zinc-900 border-b border-slate-700 dark:border-zinc-800">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setRequestFormat('curl')}
              className={`px-2 py-1 rounded transition-colors ${requestFormat === 'curl' ? 'text-slate-100 dark:text-zinc-200 bg-slate-700 dark:bg-zinc-700' : 'text-slate-500 dark:text-zinc-500 hover:text-slate-300'}`}
            >
              curl
            </button>
            <button
              onClick={() => setRequestFormat('python')}
              className={`px-2 py-1 rounded transition-colors ${requestFormat === 'python' ? 'text-slate-100 dark:text-zinc-200 bg-slate-700 dark:bg-zinc-700' : 'text-slate-500 dark:text-zinc-500 hover:text-slate-300'}`}
            >
              python
            </button>
          </div>
          <button
            onClick={handleCopySample}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-200 dark:text-zinc-500 dark:hover:text-zinc-300 hover:bg-slate-700 dark:hover:bg-zinc-700 rounded transition-colors"
          >
            <Copy className="w-3 h-3" /> Copy
          </button>
        </div>
        <pre className="p-4 overflow-x-auto text-[12px] font-mono text-slate-100 dark:text-zinc-200 whitespace-pre-wrap break-words">
          {codeSamples[requestFormat]}
        </pre>
      </div>

        <div className="space-y-4">
        </div>

      <div className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500">Create New Key</h3>
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Key Name</label>
          <input 
            type="text" 
            value={newName}
            onChange={(e) => setNewName(e.target.value.slice(0, 32))}
            maxLength={32}
            placeholder="e.g. Production API"
            className="w-full bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-zinc-600"
          />
        </div>
      </div>
      <button 
        onClick={async () => {
          if (newName.trim() && !creating) {
            setCreating(true);
            setError(null);
            const err = await onAdd(newName);
            if (err) {
              setError(err);
            } else {
              setNewName('');
            }
            setCreating(false);
          }
        }}
        disabled={!newName.trim() || atLimit || creating}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-zinc-800 disabled:text-slate-500 dark:disabled:text-zinc-600 text-white py-4 rounded-2xl font-bold shadow-lg shadow-indigo-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
      >
        <Plus className="w-5 h-5" /> {creating ? 'Creating...' : atLimit ? 'Limit Reached (5)' : 'Create Key'}
      </button>
      {error && <p className="text-xs text-red-500 text-center">{error}</p>}

      <div className="space-y-3 pt-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500">API Keys</h3>
        {apiKeys.length === 0 ? (
          <div className="p-8 text-center border-2 border-dashed border-slate-100 dark:border-zinc-800 rounded-3xl text-slate-400">
            No keys registered.
          </div>
        ) : (
          apiKeys.map(k => (
            <div 
              key={k.id}
              className="p-4 rounded-2xl border bg-white dark:bg-zinc-900 border-slate-100 dark:border-zinc-800 shadow-sm flex items-center justify-between group"
            >
              <div className="flex items-center gap-4">
                <div className="w-3 h-3 rounded-full bg-slate-300 dark:bg-zinc-700" />
                <div>
                  <p className="text-sm font-bold">{k.name}</p>
                  <p className="text-[11px] font-mono text-slate-400 dark:text-zinc-500">{k.prefix}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                   onClick={(e) => { e.stopPropagation(); onRemove(k.id); }}
                   aria-label="Delete"
                   className="p-2 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-500 rounded-xl transition-colors shadow-sm"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ThemeSwitcher({ current, onSelect }: { current: Theme; onSelect: (t: Theme) => void }) {
  return (
    <div className="flex items-center p-1 bg-slate-100 dark:bg-zinc-800 rounded-xl border border-slate-200 dark:border-zinc-700">
      <ThemeButton 
        active={current === 'light'} 
        icon={<Sun className="w-4 h-4" />} 
        label="Light"
        onClick={() => onSelect('light')} 
      />
      <ThemeButton 
        active={current === 'system'} 
        icon={<Monitor className="w-4 h-4" />} 
        label="System"
        onClick={() => onSelect('system')} 
      />
      <ThemeButton 
        active={current === 'dark'} 
        icon={<Moon className="w-4 h-4" />} 
        label="Dark"
        onClick={() => onSelect('dark')} 
      />
    </div>
  );
}

function ThemeButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      aria-label={label}
      className={`p-2 rounded-lg transition-all ${
        active 
          ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-400 shadow-sm' 
          : 'text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200'
      }`}
    >
      {icon}
    </button>
  );
}

function ToggleButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button 
      onClick={onToggle}
      className={`w-12 h-6 rounded-full transition-all relative p-1 ${active ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-zinc-700'}`}
    >
      <div className={`w-4 h-4 bg-white rounded-full shadow-md transition-all ${active ? 'translate-x-6' : 'translate-x-0'}`} />
    </button>
  );
}

function ProviderManager({ providers, onAdd, onUpdate, onRemove }: {
  providers: Provider[];
  onAdd: (name: string, baseUrl: string, models: string, rateLimits?: string, apiKey?: string, queueMaxSize?: number) => Promise<string | null>;
  onUpdate: (id: string, updates: { name?: string; base_url?: string; models?: string; api_key?: string; rate_limits?: string; queue_max_size?: number }) => Promise<string | null>;
  onRemove: (id: string) => void;
}) {
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newModels, setNewModels] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [newRateLimits, setNewRateLimits] = useState('');
  const [newQueueMaxSize, setNewQueueMaxSize] = useState(5);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editModels, setEditModels] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editRateLimits, setEditRateLimits] = useState('');
  const [editQueueMaxSize, setEditQueueMaxSize] = useState(5);

  const handleAdd = async () => {
    if (!newName.trim() || !newUrl.trim() || creating) return;
    setCreating(true);
    setError(null);
    const err = await onAdd(newName.trim(), newUrl.trim(), newModels.trim() || 'default', newRateLimits.trim() || undefined, newApiKey.trim() || undefined, newQueueMaxSize);
    if (err) {
      setError(err);
    } else {
      setNewName('');
      setNewUrl('');
      setNewModels('');
      setNewApiKey('');
      setNewRateLimits('');
      setNewQueueMaxSize(5);
    }
    setCreating(false);
  };

  const startEdit = (provider: Provider) => {
    setEditingId(provider.id);
    setEditName(provider.name);
    setEditUrl(provider.base_url);
    setEditModels(provider.models);
    setEditApiKey('');
    setEditRateLimits(provider.rate_limits || '');
    setEditQueueMaxSize(provider.queue_max_size ?? 5);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditUrl('');
    setEditModels('');
    setEditApiKey('');
    setEditRateLimits('');
    setEditQueueMaxSize(5);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const err = await onUpdate(editingId, {
      name: editName.trim(),
      base_url: editUrl.trim(),
      models: editModels.trim(),
      api_key: editApiKey.trim(),
      rate_limits: editRateLimits.trim() || undefined,
      queue_max_size: editQueueMaxSize
    });
    if (!err) {
      cancelEdit();
    }
  };

  return (
    <div className="space-y-6">
      {/* Add New Provider Form */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500">Add New Provider</h3>
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value.slice(0, 64))}
                maxLength={64}
                placeholder="e.g. Ollama Local"
                className="w-full bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-zinc-600"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">URL</label>
              <input
                type="text"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="http://localhost:11434/v1"
                className="w-full bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-zinc-600"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Models</label>
              <input
                type="text"
                value={newModels}
                onChange={(e) => setNewModels(e.target.value)}
                placeholder="llama3,mistral"
                className="w-full bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-zinc-600"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Rate Limits</label>
              <input
                type="text"
                value={newRateLimits}
                onChange={(e) => setNewRateLimits(e.target.value)}
                placeholder="10:request:minute,1:request:second"
                pattern="^(\d+:request:(second|minute|hour|day),?)+$"
                title="Format: limit:request:unit (e.g. 10:request:minute,1:request:second)"
                className="w-full bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-zinc-600"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">API Key</label>
              <input
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="API Key (optional)"
                className="w-full bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-zinc-600"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 ml-1">Queue Max Size</label>
              <input
                type="number"
                value={newQueueMaxSize}
                onChange={(e) => setNewQueueMaxSize(parseInt(e.target.value, 10) || 1)}
                min={1}
                placeholder="5"
                className="w-full bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-zinc-600"
              />
            </div>
          </div>
        <button
          onClick={handleAdd}
          disabled={!newName.trim() || !newUrl.trim() || creating}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-zinc-800 disabled:text-slate-500 dark:disabled:text-zinc-600 text-white py-3 rounded-2xl font-bold shadow-lg shadow-indigo-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> {creating ? 'Adding...' : 'Add Provider'}
        </button>
        {error && <p className="text-xs text-red-500 text-center">{error}</p>}
      </div>

      {/* Providers List */}
      <div className="space-y-3 pt-6 border-t border-slate-100 dark:border-zinc-800">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500">Configured Providers</h3>
        {providers.length === 0 ? (
          <div className="p-8 text-center border-2 border-dashed border-slate-100 dark:border-zinc-800 rounded-3xl text-slate-400">
            No providers configured.
          </div>
        ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-zinc-800/50 border-b border-slate-200 dark:border-zinc-800">
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Name</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">URL</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Models</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Rate Limits</th>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Queue</th>
                  <th className="text-right p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {providers.map(provider => (
                  <tr key={provider.id} className="border-b border-slate-100 dark:border-zinc-800 last:border-b-0 hover:bg-slate-50 dark:hover:bg-zinc-800/30 transition-colors">
                    {editingId === provider.id ? (
                      <>
                        <td className="p-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg p-2 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={editUrl}
                            onChange={(e) => setEditUrl(e.target.value)}
                            className="w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg p-2 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={editModels}
                            onChange={(e) => setEditModels(e.target.value)}
                            className="w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg p-2 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={editRateLimits}
                            onChange={(e) => setEditRateLimits(e.target.value)}
                            placeholder="10:request:minute,1:request:second"
                            pattern="^(\d+:request:(second|minute|hour|day),?)+$"
                            title="Format: limit:request:unit (e.g. 10:request:minute,1:request:second)"
                            className="w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg p-2 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            value={editQueueMaxSize}
                            onChange={(e) => setEditQueueMaxSize(parseInt(e.target.value, 10) || 1)}
                            min={1}
                            placeholder="5"
                            className="w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg p-2 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="password"
                            value={editApiKey}
                            onChange={(e) => setEditApiKey(e.target.value)}
                            placeholder="API Key (optional)"
                            className="w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg p-2 text-sm text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={saveEdit}
                              className="p-2 hover:bg-green-50 dark:hover:bg-green-950/30 text-green-600 rounded-xl transition-colors"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-2 hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-500 rounded-xl transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-zinc-700" />
                            <span className="font-bold text-slate-700 dark:text-zinc-200">{provider.name}</span>

                          </div>
                        </td>
                        <td className="p-4 font-mono text-xs text-slate-500 dark:text-zinc-400">{provider.base_url}</td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-1">
                            {provider.models.split(',').map((model, i) => (
                              <span key={i} className="text-[11px] font-mono bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 px-2 py-0.5 rounded-full">{model.trim()}</span>
                            ))}
                          </div>
                        </td>
                        <td className="p-4 font-mono text-xs text-slate-500 dark:text-zinc-400">
                          {(provider.rate_limits || 'default').split(',').map((r, i) => <div key={i}>{r.trim()}</div>)}
                        </td>
                        <td className="p-4 font-mono text-xs text-slate-500 dark:text-zinc-400">
                          {provider.queue_max_size ?? 5}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-end gap-1">
                            {!provider.immutable && (
                              <>
                                <button
                                  onClick={() => startEdit(provider)}
                                  aria-label="Edit"
                                  className="p-2 hover:bg-slate-100 dark:hover:bg-zinc-700 text-slate-500 rounded-xl transition-colors"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => onRemove(provider.id)}
                                  aria-label="Delete"
                                  className="p-2 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-500 rounded-xl transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
