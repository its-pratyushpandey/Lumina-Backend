// AI integration via an OpenAI-compatible HTTP API.
// Supports xAI (Grok) and Groq with defensive config inference.

const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_XAI_CHAT_MODEL = 'grok-2-latest';
const DEFAULT_GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile';

const looksLikeGroqKey = (apiKey) => typeof apiKey === 'string' && apiKey.startsWith('gsk_');
const looksLikeXaiKey = (apiKey) => typeof apiKey === 'string' && (apiKey.startsWith('xai-') || apiKey.startsWith('xsk_'));

const safeHostnameFromUrl = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

const normalizeProvider = (provider) => {
  const p = String(provider || '').trim().toLowerCase();
  if (p === 'groq') return 'groq';
  if (p === 'xai' || p === 'grok') return 'xai';
  return null;
};

const getConfig = () => {
  const apiKey = process.env.GROK_API_KEY?.trim();
  const baseUrlRaw = process.env.GROK_API_BASE_URL;
  const baseUrlCandidate = (baseUrlRaw || DEFAULT_XAI_BASE_URL)?.trim();
  const chatModelRaw = process.env.GROK_CHAT_MODEL;
  const chatModelCandidate = (chatModelRaw || DEFAULT_XAI_CHAT_MODEL)?.trim();
  const jsonModelRaw = process.env.GROK_JSON_MODEL;
  const jsonModelCandidate = (jsonModelRaw || chatModelCandidate)?.trim();
  const timeoutMs = Number(process.env.GROK_TIMEOUT_MS || 25000);

  const hostname = safeHostnameFromUrl(baseUrlCandidate);
  const baseLooksGroq = hostname?.endsWith('groq.com');
  const baseLooksXai = hostname?.endsWith('x.ai');
  const envProvider = normalizeProvider(process.env.GROK_PROVIDER);

  let provider = envProvider;
  if (!provider) {
    if (baseLooksGroq) provider = 'groq';
    else provider = 'xai';
  }

  // Auto-heal a very common misconfig: Groq key (gsk_*) used with xAI base URL.
  if (provider === 'xai' && looksLikeGroqKey(apiKey) && baseLooksXai) {
    provider = 'groq';
  }

  // And the reverse: xAI key used with Groq base URL.
  if (provider === 'groq' && looksLikeXaiKey(apiKey) && baseLooksGroq) {
    provider = 'xai';
  }

  const baseUrl = provider === 'groq' ? DEFAULT_GROQ_BASE_URL : DEFAULT_XAI_BASE_URL;

  // If the user explicitly configured GROK_API_BASE_URL, keep it unless it is clearly mismatched.
  // (Mismatch = Groq key + xAI host OR xAI key + Groq host.)
  let resolvedBaseUrl = baseUrlCandidate;
  if (hostname) {
    if (provider === 'groq' && baseLooksXai && looksLikeGroqKey(apiKey)) {
      resolvedBaseUrl = DEFAULT_GROQ_BASE_URL;
    } else if (provider === 'xai' && baseLooksGroq && looksLikeXaiKey(apiKey)) {
      resolvedBaseUrl = DEFAULT_XAI_BASE_URL;
    }
  } else {
    // Invalid URL -> fall back to provider default.
    resolvedBaseUrl = baseUrl;
  }

  const defaultChatModel = provider === 'groq' ? DEFAULT_GROQ_CHAT_MODEL : DEFAULT_XAI_CHAT_MODEL;

  // Auto-heal mismatched model defaults when provider got inferred.
  let resolvedChatModel = chatModelCandidate;
  if (provider === 'groq' && /^grok-/i.test(resolvedChatModel)) {
    resolvedChatModel = defaultChatModel;
  }

  let resolvedJsonModel = jsonModelCandidate;
  if (provider === 'groq' && /^grok-/i.test(resolvedJsonModel)) {
    resolvedJsonModel = resolvedChatModel;
  }

  const resolvedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 25000;

  return {
    apiKey,
    baseUrl: resolvedBaseUrl,
    chatModel: resolvedChatModel,
    jsonModel: resolvedJsonModel,
    provider,
    timeoutMs: resolvedTimeoutMs,
  };
};

class GrokConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GrokConfigError';
  }
}

class GrokApiError extends Error {
  constructor(message, { status, upstreamBody, provider, baseUrl, model } = {}) {
    super(message);
    this.name = 'GrokApiError';
    this.status = status;
    this.upstreamBody = upstreamBody;
    this.provider = provider;
    this.baseUrl = baseUrl;
    this.model = model;
  }
}

const requireGrokConfig = () => {
  const { apiKey, baseUrl, provider, chatModel } = getConfig();
  if (!apiKey) throw new GrokConfigError('Missing GROK_API_KEY');
  if (!baseUrl) throw new GrokConfigError('Missing GROK_API_BASE_URL');

  // Friendly diagnostics for common mistakes.
  const hostname = safeHostnameFromUrl(baseUrl);
  if (!hostname) throw new GrokConfigError('Invalid GROK_API_BASE_URL');
  if (provider === 'xai' && looksLikeGroqKey(apiKey)) {
    throw new GrokConfigError(
      'GROK_API_KEY looks like a Groq key (gsk_*). Either set GROK_API_BASE_URL=https://api.groq.com/openai/v1 and a Groq model, or use a valid xAI key.'
    );
  }
  if (provider === 'groq' && looksLikeXaiKey(apiKey) && hostname.endsWith('groq.com')) {
    // ok
  }
  if (!chatModel) throw new GrokConfigError('Missing GROK_CHAT_MODEL');
};

const callChatCompletions = async ({ model, messages, tools, tool_choice, temperature, max_tokens, response_format }) => {
  requireGrokConfig();
  const { apiKey, baseUrl, provider, timeoutMs } = getConfig();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice,
        temperature,
        max_tokens,
        response_format,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new GrokApiError('AI request timed out', { provider, baseUrl, model });
    }
    throw new GrokApiError(`AI request failed: ${error?.message || 'unknown error'}`, { provider, baseUrl, model });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const snippet = text && text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
    throw new GrokApiError(`AI provider error (${response.status})`, {
      status: response.status,
      upstreamBody: snippet || response.statusText,
      provider,
      baseUrl,
      model,
    });
  }

  return response.json();
};

// Define function tools for product search and account helpers.
export const grokTools = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description: 'Search for products based on query, category, price range',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for products' },
          category: { type: 'string', description: 'Product category filter' },
          minPrice: { type: 'number', description: 'Minimum price filter' },
          maxPrice: { type: 'number', description: 'Maximum price filter' },
          sortBy: { type: 'string', description: 'Sorting (createdAt, price, -price, -rating)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_details',
      description: 'Get detailed information about a specific product',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID' },
        },
        required: ['productId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_cart_info',
      description: 'Get current cart information for the user',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'track_order',
      description: 'Track order status by order number',
      parameters: {
        type: 'object',
        properties: {
          orderNumber: { type: 'string', description: 'Order number to track' },
        },
        required: ['orderNumber'],
      },
    },
  },
];

export const chatWithGrok = async (messages, { tools = grokTools } = {}) => {
  const { chatModel } = getConfig();

  const json = await callChatCompletions({
    model: chatModel,
    messages,
    tools,
    tool_choice: 'auto',
    temperature: 0.7,
    max_tokens: 1024,
  });

  const choice = json?.choices?.[0];
  if (!choice?.message) {
    throw new Error('Grok returned no message');
  }

  return choice;
};

const extractJsonObject = (text) => {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
};

export const semanticSearch = async (query) => {
  try {
    const { jsonModel } = getConfig();

    const json = await callChatCompletions({
      model: jsonModel,
      messages: [
        {
          role: 'system',
          content:
            'You are a search query analyzer. Convert natural language shopping queries into structured JSON. Respond ONLY with valid JSON containing: category (string|null), minPrice (number|null), maxPrice (number|null), keywords (string[]), sortBy (string|null).',
        },
        {
          role: 'user',
          content: `Convert this search query into structured parameters: "${query}"`,
        },
      ],
      temperature: 0.2,
      max_tokens: 256,
      response_format: { type: 'json_object' },
    });

    const content = json?.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(content);
    if (parsed) return parsed;
    return { category: null, minPrice: null, maxPrice: null, keywords: [query], sortBy: null };
  } catch (error) {
    // Fail safely: semantic search should never crash the app.
    return { category: null, minPrice: null, maxPrice: null, keywords: [query], sortBy: null, error: error?.message };
  }
};

export const generateProductDescription = async ({ name, category, features, priceRange }) => {
  const { chatModel } = getConfig();

  const prompt = `Generate an SEO-optimized, engaging product description for an e-commerce platform.

Product Details:
- Name: ${name}
- Category: ${category}
- Key Features: ${features || 'N/A'}
- Price Range: ${priceRange || 'N/A'}

Please provide:
1. A compelling main description (2-3 paragraphs)
2. 5-7 bullet points highlighting key features
3. A short meta description (150-160 characters)

Make it professional, persuasive, and customer-focused.`;

  const json = await callChatCompletions({
    model: chatModel,
    messages: [
      {
        role: 'system',
        content: 'You are an expert e-commerce copywriter specializing in product descriptions that convert.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 1024,
  });

  return json?.choices?.[0]?.message?.content || '';
};

export { GrokApiError, GrokConfigError };
