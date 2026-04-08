import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { tokens, title, body } = await req.json();

  if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid tokens' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Filter out empty tokens
  const validTokens = tokens.filter((t: string) => t && t.trim());
  if (validTokens.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid tokens' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Send via Expo push API
  const expoPushUrl = 'https://exp.host/--/api/v2/push/send';
  const messages = validTokens.map((token: string) => ({
    to: token,
    sound: 'default',
    title,
    body,
  }));

  try {
    const response = await fetch(expoPushUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
