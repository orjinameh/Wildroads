# Submission draft: Developers Wilding

Deadline: **Nov 11, 11:59 PM** (timezone not stated; submit by the evening of Nov 10).

## 1. Basics

- **Project name:** Wildroads
- **Otari signup email:** peterstephen22000@gmail.com
- **One line:** Wildroads turns phone sensors into a community road map: drivers' phones measure road roughness and speed on-device, and AI reports written through Otari tell communities where the bad roads and slow roads are.

## 2. Repository

- **Public GitHub repo:** https://github.com/orjinameh/Wildroads (public)
- **Hackathon branch:** `hackathon` (pushed)

```
git checkout -b hackathon
git push -u origin hackathon
```

## 3. First commit where Otari came in

Link: https://github.com/orjinameh/Wildroads/commit/f0f16e003d11b08679e61b9e0d0df5babf83a0cc

This is the initial scaffold, where Otari-written road reports first appeared. At that point the app used a self-hosted Otari; it moved to the hosted Otari platform in later commits (the Docker files were removed then).

## 4. Otari features used

Each is used by the running app, not just enabled.

| Feature | Where it is used |
|---|---|
| Multiple models in distinct roles | Analyst `deepseek/deepseek-v4.1-flash` (runs code, returns numbers) and writer `z-ai/glm-5.3-flash` (writes the report from the analyst's numbers only) |
| Code execution | The analyst computes every statistic with `otari_code_execution` |
| Web search | The analyst searches for the agency responsible for roads in the chosen area (`otari_web_search`) |
| Model routing and fallbacks | Routing policies `wildroads-analyst` (DeepSeek, backup GLM) and `wildroads-writer` (GLM, backup DeepSeek), each with a backup model; the app sends the policy name as `model` |
| Budgets and spending limits | One key per community group, each with its own budget; the app shows a clear message on `budget_exceeded` |
| Per-user budgets | A second workspace member holds their own spending ceiling; their key is one of the community groups |

Open-weight models: DeepSeek V4.1 Flash and GLM 5.3 Flash, in different roles.

## 5. Issues opened on the Otari repo

- https://github.com/mozilla-ai/otari/issues/2741
- https://github.com/mozilla-ai/otari/issues/2742

## 6. Demo video (3-5 min)

Link: https://youtu.be/C0URLrS5BfE

Script used:

1. **The problem (20 s).** Bad roads and slow roads have no community-owned data; drivers should not use their phones.
2. **The data (40 s).** The map: roughness layer, then the Traffic layer with the time-of-day filter. Say plainly how many trips and cells there are and that they are real. Mention privacy: only ~22 m cells, no identity, raw sensor data never leaves the phone.
3. **The report (60 s).** Report page: pick a community group, type the area, press Generate. Show the line naming the analyst and writer models, open "Analyst findings", read the writer's report, show the agency found by web search.
4. **Otari dashboard (60 s).** Models, the routing policies with backups, Spend & budgets (one budget per group), Members & roles (the member's own ceiling). Open the **Usage** tab and show which model served each request.
5. **Limits in action (45 s).** The report page with `demo-tiny-budget`: the friendly "used up its AI budget" message, then open "Technical details" to show Otari's real `403 budget_exceeded`. Then the member ceiling the same way.
6. **Fallback (30 s).** Only if you can show a real failure; say honestly if you configured a failing primary model on purpose.
7. **Close (15 s).** What is next: more trips, calibrated reference phones, agency partnerships.

Rule for the video: show real data only.

## 7. Feedback

- Written feedback: see `FEEDBACK.md` (answers are filled in).
- Optional 3-5 min screen recording: follow the four questions in the submission rules (what you built, what worked, what did not, what is missing).
