# Otari feedback (Wildroads, MozFest Developers Wilding)

Wildroads maps road roughness and speeds from phone sensors, with AI road reports written through Otari.

> Sections marked **TODO** need your own words or a fact only you know. Everything else was observed while building.

## Issues opened on the Otari repo

- https://github.com/mozilla-ai/otari/issues/2741 (hosted quickstart base URL does not match the API)
- https://github.com/mozilla-ai/otari/issues/2742 (sign-in fails in private windows; cause was the region selector, see friction log item 8)

## What we built with Otari

- Two open-weight models in distinct roles: `deepseek/deepseek-v4.1-flash` is the **analyst** (runs code, returns numbers as JSON), `z-ai/glm-5.3-flash` is the **writer** (plain-language report from the analyst's numbers only, no tools).
- Code execution (`otari_code_execution`) used by the analyst for every statistic.
- Web search used by the analyst to find the responsible road agency for an area.
- Routing policies: `wildroads-analyst` (DeepSeek, backup GLM) and `wildroads-writer` (GLM, backup DeepSeek); the app sends the policy name as the model.
- Budgets: one budget per community group's API key, plus a separate per-member ceiling.
- Per-user budgets: a second member with their own daily ceiling.
- Each community group's key stays on the server; road users never see a key.

## Friction log (in the order it happened)

1. **Base URL.** I started from `https://api.otari.ai/v1`. The API answered `Otari serves its API under /api/v1, not /v1`. The message was helpful, but the quickstart and the API disagreed. Reported as mozilla-ai/otari#2741.
2. **Region host.** My key belonged to the EU region and `api.otari.ai` refused it with `This API key belongs to eu.api.otari.ai`. Again the error was clear; I found the host from the error message, not from the dashboard.
3. **Model access.** A brand-new key returned an empty `/models` list and `403 model_not_allowed` for every model. It was fixed by changing access in the dashboard; I did not note which page or switch, so I cannot say exactly. A message pointing to the setting would have saved time.
4. **Provider error.** `'z-ai/glm-5.3-flash': unknown provider or instance 'z-ai'` appeared while the model list showed that id. I did not note where I saw it or what changed afterwards; it went away once the base URL, region host and model access were correct, so the cause was probably the same access problem.
5. **Web search.** The first call returned `web search is not enabled for this workspace`. The message was clear; it had to be turned on in the dashboard (I did not note the exact page).
6. **Guardrails.** They need a third-party vendor's key, so I did not use them. A built-in check would have made this feature easy to adopt.
7. **Budgets.** Budgets are shared objects: editing one moves everyone held to it, and a per-member ceiling lives on a different page (Members & roles) from the key budgets (Spend & budgets). It took several screens to understand. Once understood, it worked well.
8. **Login and region.** Signing in to the hosted dashboard in a private window said `wrong email or password` with the correct credentials, in three browsers, for two accounts. The cause was the region selector: a private window forgets it and defaults to the US region, while my account lives in the EU region, so the account was simply not found there. Changing the region to EU fixed it. The error message gave no hint about regions. Suggestion: when the email is not found in the selected region, say so ("no account in the US region, try EU"), or remember the region. I reported it first as a bug (mozilla-ai/otari#2742) and then added the explanation.
9. **Routing responses.** A request sent to a routing policy returns the policy name as the model, so the app cannot show which model really answered. The Usage tab shows it.
10. **Budget refusal.** A key with a $0.02 daily budget was refused with HTTP 403 and `{"code":"budget_exceeded"}`, and the message explained why: `API key has $0.001135 of budget remaining, less than this request's estimated cost of $0.001804. The estimate assumes 3 000 output tokens; a lower output token limit on the request may let it fit`. The message was excellent. It was surprising that the refusal is a 403 rather than 402 or 429, and that it is based on an estimate from `max_tokens`, so apps need to set `max_tokens` to make small budgets predictable.
11. **Per-user budget refusal.** A member's daily ceiling (peter-group) was refused with HTTP 403 and `{"detail":"Member has exceeded budget limit","code":"budget_exceeded"}`. Unlike the key budget refusal, it does not say how much is left, what the request was estimated to cost, or whose ceiling was hit. Both refusals share the same `code`, so an app has to read the text to tell them apart. Suggestion: include the member, the remaining amount and the reset time, as the key budget message does.

## What worked well

- Error messages told me what to do (`use /api/v1`, `use eu.api.otari.ai`, `web search is not enabled`).
- OpenAI-compatible calls worked unchanged once the URL was right.
- Code execution as a built-in tool: the model ran code without me hosting a sandbox.
- Budgets and routing are visible in one place and are enforced by the gateway, not by my app.

## Written answers

**1. When were you most tempted to skip Otari and call the provider directly? What happened?**
When a brand-new key returned an empty model list and `403 model_not_allowed` for every model, and then `unknown provider 'z-ai'` on a model the list showed. I had working code and a deadline, and calling a provider directly would have skipped both. I stayed because budgets, routing and built-in tools were what the project was built around, and I fixed access in the dashboard. I did not time how long it cost.

**2. What did you end up building yourself that Otari should have done for you?**
- Showing which model actually served a request when a routing policy is used.
- Mapping a community group to its own key and budget (done with a server-side key map, `OTARI_KEYS`).
- A clear "budget used up" message for end users (the gateway returns an API error; I turned it into a readable notice).
- Spend per group in my own UI: the hosted usage endpoints (`/api/v1/usage`, `/usage/summary?group_by_tag=member`) answer `Invalid master key` to a normal API key, so my app cannot show spend. I link to the dashboard instead. A read-only usage endpoint for a key's own spend would let apps show budgets to their users.

**3. If the rules hadn't required Otari, would you have continued using Otari? Why or why not?**
Yes, for the parts that sit between my app and the models: a budget per key and per member that the gateway enforces, routing with a backup model, and built-in code execution and web search. Writing those myself would have taken longer than the setup. I would want clearer setup first: the region host, model access and tool enabling each cost me time, and the key budget and member budget refusals share one error code but give different messages.

## Video outline (3–5 min)

1. What I built (30 s): the map, the Traffic layer, the report.
2. Walk through the Otari dashboard: models, routing policy, budgets, members (60 s).
3. Generate a report and show analyst then writer in the page (60 s).
4. Show the Usage tab to prove which model served each request (30 s).
5. Show a budget refusal with the demo key, and a refusal from the member ceiling (60 s).
6. What worked / what didn't (30 s).
