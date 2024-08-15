addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === "OPTIONS") {
    return new Response("", {
      headers: {
        'Access-Control-Allow-Origin': '*',
        "Access-Control-Allow-Headers": '*'
      }, status: 204
    });
  }

  if (/^(https?:\/\/[^\/]*?)\/file\//i.test(request.url)) {
    if (request.headers.get("if-modified-since")) {
      return new Response("", { status: 304, headers: {
        'Access-Control-Allow-Origin': '*',
        "Access-Control-Allow-Headers": '*',
        "Last-Modified": request.headers.get("If-Modified-Since")
      }});
    }

    const img = await fetch(request.url.replace(/^(https?:\/\/[^\/]*?)\//, "https://telegra.ph/"));
    return new Response(img.body, { status: img.status, headers: {
      "content-type": img.headers.get("content-type"),
      'Access-Control-Allow-Origin': '*',
      "Access-Control-Allow-Headers": '*',
      "Last-Modified": (new Date()).toUTCString(),
      "Cache-Control": "public, max-age=31536000"
    }});
  }

  const url = new URL(request.url);
  const search = url.searchParams;

  if (!search.get("debug")) {
    if (url.pathname !== "/v1/chat/completions" || request.method !== "POST") {
      return new Response("Not Found or Method Not Allowed", {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          'Access-Control-Allow-Origin': '*',
          "Access-Control-Allow-Headers": '*'
        }
      });
    }
  }

  const authHeader = request.headers.get("Authorization") || "Bearer " + search.get("key");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Unauthorized: Missing or invalid Authorization header", {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        'Access-Control-Allow-Origin': '*',
        "Access-Control-Allow-Headers": '*'
      }
    });
  }

  const apiKey = authHeader.slice(7);
  let data;
  try {
    data = await request.json();
  } catch (error) {
    if (!search.get("debug")) return new Response("Bad Request: Invalid JSON", { status: 400 });
    data = { model: search.get("model") || "@cf/stabilityai/stable-diffusion-xl-base-1.0", messages: [{ role: "user", content: search.get("prompt") || "cat" }] };
  }

  if (!data || !data.model || !data.messages || data.messages.length === 0) {
    return new Response("Bad Request: Missing required fields", { status: 400 });
  }

  const prompt = data.messages[data.messages.length - 1].content;
  const cloudflareUrl = `https://api.cloudflare.com/client/v4/9364e550919c5de1618653e776fc1f81/ai/run/${data.model}`;

  const requestBody = JSON.stringify({
    prompt: prompt,
    num_inference_steps: 20,
    guidance_scale: 7.5,
    strength: 1
  });

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const uniqueId = `imggen-${currentTimestamp}`;

  try {
    const apiResponse = await fetch(cloudflareUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: requestBody,
    });

    if (!apiResponse.ok) {
      throw new Error("Request error: " + apiResponse.status);
    }

    const imageBlob = await apiResponse.blob();
    const formData = new FormData();
    formData.append("file", imageBlob, "image.jpg");

    const uploadResponse = await fetch("https://telegra.ph/upload", {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      throw new Error("Failed to upload image");
    }

    const uploadResult = await uploadResponse.json();
    const imageUrl = request.url.match(/^(https?:\/\/[^\/]*?)\//)[1] + uploadResult[0].src;

    const responsePayload = {
      id: uniqueId,
      object: "chat.completion.chunk",
      created: currentTimestamp,
      model: data.model,
      choices: [
        {
          index: 0,
          delta: {
            content: `![](${imageUrl})`,
          },
          finish_reason: "stop",
        },
      ],
    };

    const dataString = JSON.stringify(responsePayload);

    return new Response(`data: ${dataString}\n\n`, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        'Access-Control-Allow-Origin': '*',
        "Access-Control-Allow-Headers": '*',
      },
    });
  } catch (error) {
    return new Response("Internal Server Error: " + error.message, {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        'Access-Control-Allow-Origin': '*',
        "Access-Control-Allow-Headers": '*',
      },
    });
  }
}
