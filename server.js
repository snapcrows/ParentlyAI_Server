const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Универсальный прокси для любых OpenAI endpoint (включая Assistants v2, TTS, Whisper)
app.all('/openai/*', async (req, res) => {
  try {
    const openaiPath = req.path.replace(/^\/openai/, '');
    const url = `https://api.openai.com${openaiPath}`;
    console.log('---\nIncoming request:', req.method, url);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);

    // Собираем только нужные заголовки
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'OpenAI-Beta': req.headers['openai-beta'] || undefined,
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    };

    // Удаляем потенциально опасные заголовки
    delete headers['content-length'];
    delete headers['transfer-encoding'];
    delete headers['host'];
    delete headers['connection'];
    delete headers['accept-encoding'];

    const options = {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    };

    console.log('Proxying to OpenAI:', options);
    const response = await fetch(url, options);
    console.log('OpenAI response status:', response.status);
    console.log('OpenAI response headers:', Object.fromEntries(response.headers.entries()));

    // Если ошибка — выведем тело ответа в лог
    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI error:', response.status, errText);
      res.status(response.status).send(errText);
      return;
    }

    // Проксируем статус и только нужные заголовки обратно клиенту
    res.status(response.status);
    for (const [key, value] of response.headers.entries()) {
      // Не проксируем transfer-encoding и content-length обратно клиенту
      if (
        key.toLowerCase() !== 'content-length' &&
        key.toLowerCase() !== 'transfer-encoding'
      ) {
        res.setHeader(key, value);
      }
    }

    // Для SSE (stream: true) — проксируем поток
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      console.log('Proxying SSE stream to client');
      response.body.pipe(res);
    } else {
      const data = await response.text();
      console.log('Proxy sending to client:', data);
      res.status(response.status).send(data);
    }
  } catch (e) {
    console.error('Proxy server error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Для совместимости с ai.js/audio.js (обычный chat/completions)
app.post('/openai', async (req, res) => {
  try {
    console.log('---\nIncoming /openai POST');
    console.log('Body:', req.body);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(req.body),
    });

    console.log('OpenAI response status:', response.status);
    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI error:', response.status, errText);
      res.status(response.status).send(errText);
      return;
    }

    const data = await response.text();
    console.log('Proxy sending to client:', data);
    res.status(response.status).send(data);
  } catch (e) {
    console.error('Proxy server error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('Proxy server running on port', PORT));
