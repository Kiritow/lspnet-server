# lspnet-server

Control plane for **LSPNet**: an overlay network of nodes connected by WireGuard links, with OSPF running on top.

The server keeps track of clusters, the nodes that join them and the links between those nodes. It hands out WireGuard keys, ports and link subnets, and it collects link and routing telemetry from the nodes. It doesn't carry any traffic itself.

Related projects:

- [lspnet-web](https://github.com/Kiritow/lspnet-web): web admin panel, talks to `/api/admin` and `/auth`
- [lspnet-tools-node](https://github.com/Kiritow/lspnet-tools-node): node agent, talks to `/api/v1/node`

## How it works

### Concepts

| Concept            | Description                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cluster**        | A network with its own subnet. When the cluster is created, the subnet is split into `/30` link subnets (for example, `10.0.0.0/16` gives 16384 of them). |
| **Node**           | A machine running the agent. It is identified by an Ed25519 signing key, which it registers when it joins with a join token.                              |
| **Node config**    | A JSON document that an admin edits for each node: public IP, allowed ports, OSPF settings and so on. See [Node config](#node-config).                    |
| **Link template**  | The link an admin asks for between two nodes. The `src` node is the WireGuard client and the `dst` node is the WireGuard server.                          |
| **WireGuard link** | One end of a link, as a single node sees it. Each ready template has two: a client link on `src` and a server link on `dst`.                              |
| **Key pool**       | Nodes generate WireGuard key pairs locally and upload only the public keys. Each link takes one unused key from each node's pool.                         |

### Link lifecycle

1. An admin creates a link template with the destination IP and UDP port.
2. The **link controller** goes through every enabled template that isn't ready yet:
    - It takes an unused WireGuard key from each node's pool.
    - It allocates a free `/30` subnet from the cluster. The server end gets `.1` and the client end gets `.2`.
    - It creates the client link (endpoint `connectIP:port`, keepalive 25) and the server link (listening on `port`), then marks the template ready.
    - If a node runs out of keys, the template is skipped until a later run.
3. Nodes poll `GET /api/v1/node/peers` and configure their WireGuard interfaces to match.
4. On every key sync, the server tells each node how many new keys to generate: the keys still needed by pending templates, plus 2 spare (`WGKEY_SPARE_PER_NODE`).

Updating, enabling or disabling a template resets it to "not ready". **The link controller only runs when `POST /api/admin/link/refresh` is called**, which is the "Render All" button in lspnet-web. Nothing reaches the nodes until then.

A template must be disabled before it can be deleted. Deleting it removes both WireGuard links and returns the keys and the subnet to the pool.

## Requirements

- Node.js 22
- MySQL 8
- InfluxDB 2.x (for link telemetry)
- A GitHub OAuth App (for admin login)
- A reverse proxy that terminates HTTPS (see [Deployment](#deployment))

## Configuration

All settings are read from JSON files in the **current working directory** at startup. Each `*.secret` file is git-ignored.

| File                   | Content                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `mysql.secret`         | `{"host": "...", "port": 3306, "user": "...", "password": "...", "database": "lspnet"}` |
| `influxdb.secret`      | `{"url": "...", "token": "...", "org": "...", "bucket": "..."}`                         |
| `oauth_github.secret`  | `{"id": "<client id>", "secret": "<client secret>"}`                                    |
| `koa.secret`           | JSON array of random strings, used as cookie signing keys                               |
| `service_token.secret` | JSON array of 32-byte hex keys, used to encrypt join tokens with AES-256-GCM            |

To generate `koa.secret` and `service_token.secret`:

```sh
python3 prepare_secret.py
```

Set the GitHub OAuth App's callback URL to `https://<your-host>/auth/login/github/callback`.

| Environment variable | Default | Description      |
| -------------------- | ------- | ---------------- |
| `LISTEN_PORT`        | `6666`  | HTTP listen port |

## Database setup

`sql/dump.sql` holds the base schema. Changes made after it are in `sql/migrations/` and must be applied in order:

```sh
mysql -u root -p -e 'CREATE DATABASE lspnet'
mysql -u root -p lspnet < sql/dump.sql
mysql -u root -p lspnet < sql/migrations/001_node_wgkey_request.sql
```

> [!WARNING]
> `dump.sql` starts with `DROP TABLE IF EXISTS` for every table. Only run it against an empty database. For an existing database, apply only the migrations you don't have yet.

## Development

```sh
npm install
npm run build   # ESLint, then tsc into dist/
npm start       # node --enable-source-maps dist/index.js
```

| Command          | Description                     |
| ---------------- | ------------------------------- |
| `npm run build`  | Lint, clean `dist/` and compile |
| `npm run eslint` | ESLint only                     |
| `npm start`      | Run the compiled server         |

Logs go to the console.

## Deployment

`ecosystem.config.js` runs the server with PM2 in cluster mode, using one worker per CPU:

```sh
npm ci && npm run build
pm2 start ecosystem.config.js
```

The server must run behind a reverse proxy that terminates HTTPS:

- The session cookie is `secure`, and Koa runs with `proxy: true`. The proxy has to send `X-Forwarded-Proto: https`, or logins will fail.
- The client IP is taken from `CF-Connecting-IP` if present, otherwise from `X-Forwarded-For`.
- lspnet-web expects `/api/` and `/auth/` on its own origin, so route both paths to this server. The node agent uses `/api/v1/node/` on the same host.

```nginx
location /api/  { proxy_pass http://127.0.0.1:6666; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header Host $host; }
location /auth/ { proxy_pass http://127.0.0.1:6666; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header Host $host; }
```

> [!NOTE]
> The OSPF topology reported by nodes is kept in process memory. In PM2 cluster mode each worker has its own copy, so `GET /api/admin/cluster/topology` returns whatever the answering worker last received.

## Getting started

1. Sign in at `https://<your-host>/auth/login/github`. The first login creates the user.
2. Create a cluster with a subnet (`POST /api/admin/cluster/create`). The creator becomes the cluster's admin.
3. Generate a join token (`POST /api/admin/cluster/create_join_token`). It is valid for **3 minutes**.
4. Install lspnet-tools-node on the machine and join with the token.
5. Set the node's config (`POST /api/admin/node/update_config`).
6. Create links between nodes, then run the link controller (`POST /api/admin/link/refresh`).

All of these steps can also be done from lspnet-web.

### Roles

Each user has one role per cluster, stored in `t_user_role`:

| Role | Can do                                                        |
| ---- | ------------------------------------------------------------- |
| `0`  | View the cluster, nodes and links                             |
| `1`  | Also create, update, enable/disable and delete links          |
| `2`  | Also create join tokens and edit node configs (cluster admin) |

There is no API for adding other users to a cluster yet. To do that, insert rows into `t_user_role` directly.

## API

### Auth: `/auth`

| Method | Path                     | Description                                                                          |
| ------ | ------------------------ | ------------------------------------------------------------------------------------ |
| GET    | `/login/github`          | Redirect to GitHub. `?service=/path` sets where to go after login (default `/admin`) |
| GET    | `/login/github/callback` | OAuth callback. Creates the user on first login                                      |
| GET    | `/logout`                | Clear the session                                                                    |
| GET    | `/user`                  | Current user, or `401`                                                               |

### Admin: `/api/admin`

These endpoints need a logged-in session.

| Method | Path                         | Description                                                           |
| ------ | ---------------------------- | --------------------------------------------------------------------- |
| GET    | `/cluster/list`              | Clusters the user has a role in                                       |
| GET    | `/cluster/info?id=`          | Cluster details and the user's role                                   |
| POST   | `/cluster/create`            | `{name, subnet}`                                                      |
| POST   | `/cluster/create_join_token` | `{id}`. Role 2                                                        |
| GET    | `/cluster/topology?id=`      | OSPF topology graph (`nodes`, `edges`)                                |
| GET    | `/node/list?clusterId=`      | Nodes in a cluster                                                    |
| GET    | `/node/info?id=`             | Node details                                                          |
| POST   | `/node/update_config`        | `{id, config}`, where `config` is a JSON string. Role 2               |
| GET    | `/link/list?clusterId=`      | Link templates in a cluster                                           |
| GET    | `/link/info?id=`             | Link template details                                                 |
| POST   | `/link/create`               | `{clusterId, srcNodeId, dstNodeId, dstIP, dstPort, extra?}`. Role ≥ 1 |
| POST   | `/link/update`               | `{id, connectIP, dstPort, extra?}`. Role ≥ 1                          |
| POST   | `/link/set_enabled`          | `{id, enabled}`. Role ≥ 1                                             |
| POST   | `/link/delete`               | `{id}`. The link must be disabled first. Role ≥ 1                     |
| POST   | `/link/refresh`              | Run the link controller (experimental)                                |

`dstPort` must be between 1024 and 65535, and it can't already be in use by another link on the destination node.

### Node: `/api/v1/node`

| Method | Path                   | Description                                                                                      |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------ |
| POST   | `/join`                | `{token, publicSignKey, name}`. Registers a node with its Ed25519 public key in PEM. Not signed  |
| GET    | `/info`                | The node's own record                                                                            |
| GET    | `/config`              | `{config}` as a raw JSON string. Returns `202` if the config is missing or invalid               |
| POST   | `/sync_wireguard_keys` | `{keys: [publicKey, ...]}`. Returns `request`, the number of new keys to generate                |
| GET    | `/peers`               | WireGuard links this node should bring up                                                        |
| POST   | `/link_telemetry`      | `{links: [{id, ping, rx, tx}]}`. Written to InfluxDB. Also counts as a heartbeat                 |
| POST   | `/router_telemetry`    | `{area_routers, other_asbrs}`, the OSPF state. Feeds the topology view and counts as a heartbeat |
| POST   | `/status`              | Placeholder. Not stored yet                                                                      |

Every endpoint except `/join` needs a signed request:

| Header             | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| `X-Client-ID`      | Hex SHA-256 of the node's Ed25519 public key (SPKI DER) |
| `X-Client-Nonce`   | Random string                                           |
| `X-Client-Sign`    | Hex Ed25519 signature, see below                        |
| `X-Client-Version` | Agent version (optional; stored with the heartbeat)     |

What gets signed:

- `GET`: `<path>\n<nonce>\n<query string>`
- `POST`: `<path>\n<nonce>\n<raw request body>`

## Data formats

### Node config

```json
{
    "ip": "203.0.113.10",
    "external": true,
    "ddns": false,
    "exitNode": false,
    "allowedTCPPorts": [],
    "allowedUDPPorts": [51820, 51821, 51822],
    "ospf": { "area": 0, "cost": 10, "auth": "" }
}
```

Optional fields: `vethCIDR`, `dummy` (`[{name, addressCIDR, mtu}]`) and `ospf`. The agent uses most of these. If a link template has no connect IP and the destination node is `external`, the link controller uses the node's `ip`.

### Link `extra`

The optional `extra` field of a link template is a JSON string:

```json
{
    "ospf": {
        "cost": 10,
        "ping": true,
        "offset": 0,
        "auth": "",
        "offset_client": 0,
        "offset_server": 0
    },
    "multilisten": [51830],
    "multiport": [51830],
    "underlay": {
        "provider": "gost",
        "config": {
            "client_port": 30000,
            "server_port": 30001,
            "enable_auth": true
        }
    }
}
```

- `ospf` is required. `offset_client` and `offset_server` override `offset` on the matching end.
- `multilisten` is passed to the server end of the link, and `multiport` to the client end.
- `underlay` is optional and tunnels WireGuard over another transport:
    - `gost`: the agent runs a gost relay. With `enable_auth`, the server generates a username and password and keeps them across template updates.
    - `local`: the node maintains the underlay itself. The client end connects to `client_addr:client_port` (default `127.0.0.1`).

### Telemetry

Link telemetry is written to InfluxDB as measurement `inf.network.monitoring`:

- Tags: `network` (cluster name), `host` (node reporting the link end), `name` (peer node), `link` (link template ID)
- Fields: `ping`, `rx`, `tx`. `ping` is dropped when it is below 1.

## Project structure

```
src/
├── index.ts             # Koa app: session, body parser, routers
├── auth-api.ts          # /auth: GitHub OAuth login, logout, current user
├── admin-api.ts         # /api/admin: clusters, nodes, links
├── node-api.ts          # /api/v1/node: signed API for node agents
├── link-controller.ts   # Turns link templates into per-node WireGuard links
├── dao.ts, base-dao.ts  # MySQL access
├── model.ts             # zod schemas: DB rows, node config, link extra, OSPF state
├── credentials.ts       # Loads the *.secret files
├── token.ts             # AES-256-GCM service tokens
├── simple-token.ts      # Cluster join tokens
├── client-pki.ts        # Ed25519 node key helper
├── influx.ts            # InfluxDB writer
├── utils.ts             # CIDR helpers, config parsing, topology cache
├── secure-channel.ts    # X25519 + Ed25519 encrypted channel (not wired up yet)
├── middleware.ts        # Request logging and error handling
├── base-log.ts          # winston logger
├── common.ts            # Shared DAO, InfluxDB and session helpers
└── consts.ts            # Link type and endpoint mode constants
sql/
├── dump.sql             # Base schema
└── migrations/          # Incremental schema changes, applied in order
```

## License

MIT
