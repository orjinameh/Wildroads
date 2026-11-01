# Otari feedback (Wildroads, MozFest Developers Wilding)

Wildroads maps road roughness and speeds from phone sensors, with AI road reports written through Otari.

> Sections marked **TODO** need your own words or a fact only you know. Everything else was observed while building.

## What we built with Otari

- Two open-weight models in distinct roles: `deepseek/deepseek-v4.1-flash` is the **analyst** (runs code, returns numbers as JSON), `z-ai/glm-5.3-flash` is the **writer** (plain-language report from the analyst's numbers only, no tools).
- Code execution (`otari_code_execution`) used by the analyst for every statistic.
- Web search used by the analyst to find the responsible road agency for an area.
- Routing policies: `wildroads-analyst` (DeepSeek, backup GLM).
- Budgets: one budget per community group's API key, plus a separate per-member ceiling.
- Per-user budgets: a second member with their own daily ceiling.
- Each community group's key stays on the server; road users never see a key.

## Friction log (in the order it happened)

1. **Base URL.** I started from `https://api.otari.ai/v1`. The API answered `Otari serves its API under /api/v1, not /v1`. The message was helpful, but the quickstart and the API disagreed.
2. **Region host.** My key belonged to the EU region and `api.otari.ai` refused it with `This API key belongs to eu.api.otari.ai`. Again the error was clear; I found the host from the error, not from the dashboard. **TODO:** check whether the dashboard shows the host anywhere and say so.
3. **Model access.** A brand-new key returned an empty `/models` list and `403 model_not_allowed` for every model. **TODO:** write what actually fixed it (which page, which switch).
4. **Provider error.** `'z-ai/glm-5.3-flash': unknown provider or instance 'z-ai'` appeared while the model list showed that id. **TODO:** say where you saw it and what changed after.
5. **Web search.** The first call returned `web search is not enabled for this workspace`. The message was clear; it had to be turned on in the dashboard. **TODO:** where.
6. **Guardrails.** They need a third-party vendor's key, so I did not use them. A built-in check would have made this feature easy to adopt.
7. **Budgets.** Budgets are shared objects: editing one moves everyone held to it, and a per-member ceiling lives on a different page (Members & roles) from the key budgets (Spend & budgets). It took several screens to understand. Once understood, it worked well.
8. **Login.** Signing in to a second account in a private browser window said `wrong email or password`; the same credentials worked in a normal window. **TODO:** confirm you used the right password.
9. **Routing responses.** A request sent to a routing policy returns the policy name as the model, so the app cannot show which model really answered. The Usage tab shows it.

## What worked well  **TODO: edit to match your experience**

- Error messages told me what to do (`use /api/v1`, `use eu.api.otari.ai`, `web search is not enabled`).
- OpenAI-compatible calls worked unchanged once the URL was right.
- Code execution as a built-in tool: the model ran code without me hosting a sandbox.
- Budgets and routing are visible in one place and are enforced by the gateway, not by my app.

## Written answers

**1. When were you most tempted to skip Otari and call the provider directly? What happened?**
**TODO:** pick the moment you really felt it. The candidates from the log: the empty model list with `403 model_not_allowed` on a new key, and the `unknown provider 'z-ai'` error. Say what you did and how long it cost.

**2. What did you end up building yourself that Otari should have done for you?**
- Showing which model actually served a request when a routing policy is used.
- Mapping a community group to its own key and budget (done with a server-side key map, `OTARI_KEYS`).
- A clear "budget used up" message for end users (the gateway returns an API error; I turned it into a readable notice).
- Spend per group in my own UI: I could not find a usage API for the hosted platform in the docs, so I link to the Usage tab instead.

**3. If the rules hadn't required Otari, would you have continued using Otari? Why or why not?**
**TODO:** your honest answer. Points you can draw on: server-side budgets per key and per member, routing with fallback in one place, built-in code execution and web search. Counterpoints: the setup steps (region host, model access, tool enablement, guardrail vendor keys).

## Video outline (3–5 min)

1. What I built (30 s): the map, the Traffic layer, the report.
2. Walk through the Otari dashboard: models, routing policy, budgets, members (60 s).
3. Generate a report and show analyst then writer in the page (60 s).
4. Show the Usage tab to prove which model served each request (30 s).
5. Show a budget refusal with the demo key, and a refusal from the member ceiling (60 s).
6. What worked / what didn't (30 s).
