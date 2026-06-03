import os
import json
import requests
from fastapi import FastAPI, Request

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
    try:
        req_data = await request.json()
        model = req_data.get("model")
        messages = req_data.get("messages", [])
        stream = req_data.get("stream", False)
        enable_search = req_data.get("extra_body", {}).get("web_search", False)

        payload = {
            "type": "UNIFY_CHAT_WITH_AI",
            "model": model,
            "promptObject": {
                "prompt": merge_messages(messages),
                "settings": {
                    "webSearchSettings": {
                        "webSearch": enable_search,
                        "numOfSite": 3,
                        "maxWord": 1000
                    }
                }
            }
        }
        headers = {"API-KEY": MIN_API_KEY, "Content-Type": "application/json"}
        if not MIN_API_KEY:
            return {"success":False,"error":"Missing API KEY"}

        if stream:
            from sseclient import SSEClient
            from fastapi.responses import StreamingResponse
            resp = requests.post(f"{MIN_BASE_URL}?isStreaming=true", json=payload, headers=headers, stream=True)
            def stream_generator():
                chunk_id = f"chatcmpl-xxxx"
                for evt in SSEClient(resp).events():
                    if evt.event == "content":
                        d = json.loads(evt.data)
                        chunk = {
                            "id": chunk_id,"object":"chat.completion.chunk","created":0,"model":model,
                            "choices":[{"index":0,"delta":{"content":d["content"]},"finish_reason":None}]
                        }
                        yield f"data: {json.dumps(chunk)}\n\n"
                    elif evt.event == "done":
                        yield "data: [DONE]\n\n"
            # 重点修改：media → media_type
            return StreamingResponse(stream_generator(), media_type="text/event-stream")
        else:
            resp = requests.post(MIN_BASE_URL, json=payload, headers=headers)
            resp_json = resp.json()
            ans_content = resp_json["aiRecord"]["aiRecordDetail"]["resultObject"][0]
            openai_resp = {
                "id": resp_json["aiRecord"]["uuid"],
                "object": "chat.completion",
                "created": 0,
                "model": model,
                "choices": [{"index":0,"message":{"role":"assistant","content":ans_content},"finish_reason":"stop"}],
                "usage": None
            }
            return openai_resp
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
