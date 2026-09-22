# Public disposable TLS fixtures

PUBLIC DISPOSABLE TEST KEYS ONLY. These committed keys are intentionally public and must never be used for services or real credentials. No production secret is present.

The fixture CA is valid from September 2026 for 7300 days. Issued server certificates have fixed 2020–2040 validity; expired.pem ends in 2021. server.pem, rotated.pem and wrong-name.pem share the disposable server.key; rotated.pem has a distinct serial and certificate digest. untrusted.pem is self-signed with untrusted.key. Tests explicitly select ca.pem; no global trust is changed. OpenSSL generated these synthetic RSA-2048 fixtures.
