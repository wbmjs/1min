/**
 * 1min.AI Chat - Cloudflare Worker Backend API
 * 
 * Endpoints:
 * - POST /api/chat - Non-streaming chat
 * - POST /api/chat/stream - Streaming chat (SSE)
 * - POST /api/upload - File upload
 * - POST /api/conversation - Create conversation
 */

const API_BASE = 'https://api.1min.ai/api';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, API-KEY',
};

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/' || path === '/health') {
      return jsonResponse({ status: 'ok', service: '1min-ai-chat-api' });
    }

    // API routes
    if (path.startsWith('/api/')) {
      return handleApiRequest(request, env, path);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }
};

async function handleApiRequest(request, env, path) {
  const apiKey = env.API_KEY || request.headers.get('API-KEY');

  if (!apiKey) {
    return jsonResponse({ error: 'API key required. Set via API-KEY header or environment variable.' }, 401);
  }

  try {
    switch (path) {
      case '/api/chat':
        return handleChat(request, apiKey);
      case '/api/chat/stream':
        return handleStreamChat(request, apiKey);
      case '/api/upload':
        return handleUpload(request, apiKey);
      case '/api/conversation':
        return handleCreateConversation(request, apiKey);
      default:
        return jsonResponse({ error: 'Endpoint not found' }, 404);
    }
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleChat(request, apiKey) {
  const body = await request.json();

  const payload = {
    type: 'UNIFY_CHAT_WITH_AI',
    model: body.model || 'gpt-4o-mini',
    promptObject: {
      prompt: body.prompt,
      settings: {
        webSearchSettings: {
          webSearch: body.webSearch || false,
          numOfSite: body.numOfSite || 3,
          maxWord: body.maxWord || 1000
        },
        historySettings: {
          isMixed: false,
          historyMessageLimit: 10
        },
        withMemories: body.withMemories || false
      }
    }
  };

  if (body.conversationId) {
    payload.promptObject.conversationId = body.conversationId;
  }

  if (body.attachments) {
    payload.promptObject.attachments = body.attachments;
  }

  const response = await fetch(`${API_BASE}/chat-with-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'API-KEY': apiKey },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  return jsonResponse(data, response.status);
}

async function handleStreamChat(request, apiKey) {
  const body = await request.json();

  const payload = {
    type: 'UNIFY_CHAT_WITH_AI',
    model: body.model || 'gpt-4o-mini',
    promptObject: {
      prompt: body.prompt,
      settings: {
        webSearchSettings: {
          webSearch: body.webSearch || false,
          numOfSite: body.numOfSite || 3,
          maxWord: body.maxWord || 1000
        },
        historySettings: {
          isMixed: false,
          historyMessageLimit: 10
        },
        withMemories: body.withMemories || false
      }
    }
  };

  if (body.conversationId) {
    payload.promptObject.conversationId = body.conversationId;
  }

  if (body.attachments) {
    payload.promptObject.attachments = body.attachments;
  }

  const response = await fetch(`${API_BASE}/chat-with-ai?isStreaming=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'API-KEY': apiKey },
    body: JSON.stringify(payload)
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        await writer.write(encoder.encode(text));
      }
    } catch (e) {
      console.error('Stream error:', e);
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

async function handleUpload(request, apiKey) {
  const formData = await request.formData();
  const file = formData.get('asset');

  if (!file) {
    return jsonResponse({ error: 'No file provided' }, 400);
  }

  const uploadFormData = new FormData();
  uploadFormData.append('asset', file);

  const response = await fetch(`${API_BASE}/assets`, {
    method: 'POST',
    headers: { 'API-KEY': apiKey },
    body: uploadFormData
  });

  const data = await response.json();
  return jsonResponse(data, response.status);
}

async function handleCreateConversation(request, apiKey) {
  const body = await request.json();

  const response = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'API-KEY': apiKey },
    body: JSON.stringify({
      type: 'UNIFY_CHAT_WITH_AI',
      title: body.title || 'New Conversation',
      model: body.model || 'gpt-4o-mini'
    })
  });

  const data = await response.json();
  return jsonResponse(data, response.status);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
