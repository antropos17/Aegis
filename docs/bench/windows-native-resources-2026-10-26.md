# Controlled Windows native worker resources

Source: `2f2ad8f856505e19d2ac9d0d9703b94bf5498b51`; machine `067d49c561f56bc7`; OS `10.0.26200` x64; worker `native-csv-worker/1`; sensor mode: not-started; workload resource observation only; method: `win32-native-worker-resource-brackets/1`.

| Repetition | Useful files verified | Samples | CPU p50 / p95 (% one core) | Working set p50 / p95 (bytes) | API corroboration |
|---|---:|---:|---|---|---|
| rep1 | 2 | 4 | 43.190609219258064 / 47.54177337153579 | 32620544 / 32641024 | corroborated |
| rep2 | 2 | 4 | 39.24066278270246 / 40.56500435855369 | 32329728 / 32350208 | corroborated |
| rep3 | 2 | 4 | 39.1421472297923 / 40.848646338704405 | 32280576 / 32301056 | corroborated |

Shared-kernel API/unit corroboration only; independent physical accuracy and collector-on/off cost unqualified.

Three fixed repetitions are retained separately. First/last acquisition brackets and boundary exclusions remain in JSON; late final endpoints are excluded by the unchanged evaluator, not moved into the phase. CPU includes the fixed task and waiting within each sampled interval. Working set can include shared pages. Sampler/reference processes are outside the named single-worker scope; no product-cohort total is inferred.

Independent output checks use a closed-form CSV sum, exact bytes and owned-directory inventory. Sysmon and Procmon were not captured; hits, misses, recall, false alarms and calibrated product CPU/RSS overhead remain unavailable.

Controlled native workload resources only; no AI-agent, complete product cohort, sensor or W8 acceptance.
