export const WGLINK_TYPE_CLIENT = 0;
export const WGLINK_TYPE_SERVER = 1;

export const WGLINK_ENDPOINT_MODE_PLAINTEXT = 0;
export const WGLINK_ENDPOINT_MODE_CLIENT_RESOLVE = 1;
export const WGLINK_ENDPOINT_MODE_SERVER_RESOLVE = 2;

// unused wireguard keys every node keeps, so new links don't wait for nodes to generate keys
export const WGKEY_SPARE_PER_NODE = 2;
