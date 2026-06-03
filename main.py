import os
import json
import requests
from sseclient import SSEClient
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI(title="1min->OpenAI中转代理")
MIN_API_KEY = os.getenv("MIN_API_KEY", "")
MIN_BASE_URL = "https://api.1min.ai/api/chat-with-ai"

def merge_messages(messages: list) -> str:
    prompt = ""
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        prompt += f"{role}：{content}\n"
    return prompt.strip()

@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    req_data = await request.json()
    model = req_data.get("model")
    messages = req_data.get("messages", [])
    stream = req_data.get("stream", False)
    enable_search = req_data.get("web_search", False)

    prompt_text = merge_messages(messages)
    payload = {
        "type": "UNIFY_CHAT_WITH_AI",
        "model": model,
        "promptObject": {
            "prompt": prompt_text,
            "settings": {
                "webSearchSettings": {
                    "webSearch": enable_search,
                    "numOfSite": 3,
                    "maxWord": 1000
                }
            }
        }
    }
    headers = {
        "API-KEY": MIN_API_KEY,
        "Content-Type": "application/json"
    }

    if stream:
        resp = requests.post(f"{MIN_BASE_URL}?isStreaming=true", json=payload, headers=headers, stream=True)
        def stream_generator():
            chunk_id = f"chatcmpl-xxxx"
            yield_data_prefix = "data: "
            for evt in SSEClient(resp).events():
                if evt.event == "content":
                    d = json.loads(evt.data)
                    openai_chunk = {
                        "id": chunk_id,
                        "object": "chat.completion.chunk",
                        "created": 0,
                        "model": model,
                        "choices": [{"index": 0, "delta": {"content": d["content"]}, "finish_reason": None}]
                    }
                    yield f"{yield_data_prefix}{json.dumps(openai)}\n\n"
                elif evt.event == "done":
                    yield "data: [DONE]\n\n"
        return StreamingResponse(stream_generator(), media="text/event-stream")
    else:
        resp = requests.post(MIN_BASE_URL, json=payload, headers=headers)
        resp_json = resp.json()
        ans_content = resp_json["aiRecord"]["aiRecordDetail"]["resultObject"][0]
        openai_resp = {
            "id": resp_json["aiRecord"]["uuid"],
            "object": "chat.completion",
            "created": 0,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": ans_content},
                    "finish_reason": "stop"
                }
            ],
            "usage": None
        }
        return openai

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
