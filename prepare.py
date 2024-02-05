import secrets
import json


with open('service_token.secret', 'w') as f:
    tokens = [secrets.token_hex(32) for i in range(10)]
    f.write(json.dumps(tokens))


with open('koa.secret', 'w') as f:
    tokens = [secrets.token_hex(32) for i in range(10)]
    f.write(json.dumps(tokens))
