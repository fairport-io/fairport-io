import copy, json, os, re, subprocess, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The chart's guest values (options and pod), rendered next to this file
S = json.load(open(os.path.join(os.path.dirname(__file__), "settings.json")))
OPTS = S["options"]
# Pod options go after a "+" (Unix usernames can't contain one): ssh alice+c4m16i1t7200@host.
# Each is a letter from OPTS and a number, all optional.
FIELDS = re.compile(f"([{''.join(OPTS)}])(\\d+)")
DEFAULTS = {k: opt["default"] for k, opt in OPTS.items()}
# One file per user (the users ConfigMap), in authorized_keys format. Read on every login, so edits apply without a restart.
USERS = "/etc/users"
# The authorizedKeysCommand value, rendered next to this file only when it's set
COMMAND = os.path.join(os.path.dirname(__file__), "authorized-keys-command")
VALID_USER = re.compile(r"[a-z_][a-z0-9_.-]*")  # no slashes: the name goes into a path


def allowed(opt, v):
    # Admin limits: a "values" lookup table (Helm turns its numbers into strings), or min/max (both optional).
    return str(v) in opt["values"] if "values" in opt else opt.get("min", 0) <= v <= opt.get("max", float("inf"))


def parse(name):
    # "alice+c4m16" -> ("alice", options with defaults filled in); ValueError if an option is bad.
    user, _, opts = name.partition("+")
    if FIELDS.sub("", opts):
        raise ValueError(f"unknown option in {opts!r}")
    o = DEFAULTS | {k: int(v) for k, v in FIELDS.findall(opts)}
    bad = [f"{k}{v}" for k, v in o.items() if not allowed(OPTS[k], v)]
    if bad:
        raise ValueError(f"out of range: {', '.join(bad)}")
    return user, o


def blobs(text):
    # Matches on the key alone; authorized_keys options like from= or command= are ignored.
    return {w for line in text.splitlines() if not line.lstrip().startswith("#") for w in line.split()}


def user_keys(user):
    # The user's entry in the users ConfigMap, plus whatever authorizedKeysCommand prints for them.
    try:
        keys = open(f"{USERS}/{user}").read()
    except OSError:  # not in the users ConfigMap
        keys = ""
    # Runs for every key the client offers, uncached; add a cache here if the source is slow or rate limited.
    if os.path.exists(COMMAND):
        try:  # stderr isn't captured, so the script's own errors land in this container's log
            keys += "\n" + subprocess.run([COMMAND, user], stdout=subprocess.PIPE, text=True, timeout=5, check=True).stdout
        except (OSError, subprocess.SubprocessError) as e:
            print(f"authorizedKeysCommand failed for {user!r}: {e}", file=sys.stderr)
    return keys


def key_ok(name, offered):
    try:
        user, _ = parse(name)
    except ValueError as e:
        print(f"refusing {name!r}: {e}", file=sys.stderr)  # the user only sees "Permission denied"
        return False
    if not VALID_USER.fullmatch(user):  # checked before the name reaches a path or the command
        return False
    return offered.split()[1] in blobs(user_keys(user))


def typed(s):
    # Read as JSON when it can be, so "3600" becomes a number; "4Gi" stays a string, and '"2"' forces one.
    try:
        return json.loads(s)
    except ValueError:
        return s


def put(obj, path, value):
    # "spec.containers.0.image": numbers index lists, "\." is a dot inside a key, and missing maps are created.
    *keys, last = [k.replace("\\.", ".") for k in re.split(r"(?<!\\)\.", path)]
    for k in keys:
        obj = obj[int(k)] if isinstance(obj, list) else obj.setdefault(k, {})
    obj[int(last) if isinstance(obj, list) else last] = value


def pod_config(name):
    user, o = parse(name)
    pod = copy.deepcopy(S["pod"])  # a copy per login: logins run on parallel threads
    # Named after the user, so `kubectl get pods` shows whose it is. Pod names can't contain "_", so it becomes "-".
    pod["metadata"]["generateName"] = f"cs-{user.replace('_', '-')}-"
    for k, opt in OPTS.items():
        v = opt["values"][str(o[k])] if "values" in opt else o[k]
        for path, fmt in opt["set"].items():
            put(pod, path, typed(fmt.format(v)))
    return {"config": {"kubernetes": {"pod": pod}}}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/pubkey":
            user = req["username"].partition("+")[0]
            resp = {"success": key_ok(req["username"], req["publicKey"]),
                    "authenticatedUsername": user}
        elif self.path == "/config":
            resp = pod_config(req["username"])
        else:  # password auth is disabled in config.yaml; refuse anything else
            resp = {"success": False, "authenticatedUsername": ""}
        body = json.dumps(resp).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if sys.argv[1:] == ["test"]:
    # Built from the installed options, so it passes with whatever options the admin sets
    lo = {k: min(map(int, opt["values"])) if "values" in opt else opt.get("min", 0) for k, opt in OPTS.items()}
    hi = {k: max(map(int, opt["values"])) + 1 if "values" in opt else opt["max"] + 1
          for k, opt in OPTS.items() if "values" in opt or "max" in opt}
    assert parse("alice") == ("alice", DEFAULTS)
    assert parse("alice+" + "".join(f"{k}{v}" for k, v in lo.items())) == ("alice", lo)
    for bad in ["alice+!1", "alice+1", "alice+ "] + [f"alice+{k}{v}" for k, v in hi.items()]:
        try:
            parse(bad)
        except ValueError:
            continue
        raise AssertionError(f"{bad!r} should be refused")
    assert not VALID_USER.fullmatch("../etc")
    assert blobs("ssh-ed25519 AAAA me\n# ssh-ed25519 BBBB old") == {"ssh-ed25519", "AAAA", "me"}
    # Every option's default applies cleanly to the installed pod, without touching the shared one
    pod = pod_config("a_b")["config"]["kubernetes"]["pod"]
    assert pod["metadata"]["generateName"] == "cs-a-b-" and "generateName" not in S["pod"]["metadata"]
    p = {"spec": {"containers": [{"name": "shell"}]}}
    put(p, r"spec.containers.0.resources.limits.nvidia\.com/gpu", typed("{}".format(2)))
    put(p, "spec.containers.0.image", typed("{}".format("ubuntu:24.04")))
    put(p, "metadata.annotations.n", typed('"{}"'.format(2)))
    assert p == {"spec": {"containers": [{"name": "shell", "resources": {"limits": {"nvidia.com/gpu": 2}}, "image": "ubuntu:24.04"}]},
                 "metadata": {"annotations": {"n": "2"}}}
    print("ok")
    sys.exit()

# Localhost only: just ContainerSSH in this pod can reach it.
# Threaded so one slow login doesn't hold up everyone else's.
ThreadingHTTPServer(("127.0.0.1", 8080), Handler).serve_forever()
