import base64, json, os, ssl, subprocess, urllib.error, urllib.request

SA = "/var/run/secrets/kubernetes.io/serviceaccount"
NAME = "containerssh-hostkey"
KEY = "ssh_host_ed25519_key"

ns = open(SA + "/namespace").read()
token = open(SA + "/token").read()
ctx = ssl.create_default_context(cafile=SA + "/ca.crt")
secrets = f"https://kubernetes.default.svc/api/v1/namespaces/{ns}/secrets"


def api(method, url, body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, context=ctx) as r:
        return json.load(r)


try:
    key = base64.b64decode(api("GET", f"{secrets}/{NAME}")["data"][KEY])
except urllib.error.HTTPError as e:
    if e.code != 404:
        raise
    # First start: generate the key and store it so every later pod reuses it.
    # If two pods race here, the loser's create fails, the init container restarts, and the GET above wins.
    key = subprocess.run(["openssl", "genpkey", "-algorithm", "ed25519"],
                         check=True, capture_output=True).stdout
    api("POST", secrets, {"metadata": {"name": NAME}, "data": {KEY: base64.b64encode(key).decode()}})

os.umask(0o077)  # private key: readable only by the pod's user
with open("/keys/" + KEY, "wb") as f:
    f.write(key)
