from app.jev_client import trace_to_state


def test_trace_to_state_redacts_secrets_before_live_call():
    trace = {
        "id": "trace_secret",
        "agent_name": "agent",
        "status": "failure",
        "user_request": "Use token=super-secret-value to inspect the request",
        "steps": [
            {
                "role": "assistant",
                "action": "call",
                "tool_name": "http_get",
                "status": "error",
                "error": "Authorization: Bearer abcdefghijklmnop",
                "input": {"api_key": "example-api-key-value", "query": "safe"},
                "output": "Bearer abcdefghijklmnop",
            }
        ],
        "metadata": {
            "password": "hunter2",
            "nested": {"private_key": "never-send", "safe": "visible"},
        },
    }

    state = trace_to_state(trace)["trace"]
    serialized = str(state)

    for secret in (
        "super-secret-value",
        "abcdefghijklmnop",
        "example-api-key-value",
        "hunter2",
        "never-send",
    ):
        assert secret not in serialized
    assert "visible" in serialized
    assert "safe" in serialized
