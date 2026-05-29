import kopf
import base64
import logging
import io
import os
from kubernetes import client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@kopf.on.create('configmaps', labels={'fairport.io/node': 'true'})
@kopf.on.update('configmaps', labels={'fairport.io/node': 'true'})
def manage_node(name, namespace, reason, body, **kwargs):
    data                 = body.get('data', {})
    ip                   = data.get('ip', 'unknown')
    node_type            = data.get('type', 'agent')
    ssh_user             = data.get('ssh_user', 'root')
    ssh_port             = data.get('ssh_port', '22')
    ssh_secret_name      = data.get('ssh_secret_name', 'fp-ssh-keys')
    ssh_secret_namespace = data.get('ssh_secret_namespace', 'tinkerbell')
    ssh_secret_key       = data.get('ssh_secret_key', 'id_rsa')
    pre_install_cmd      = data.get('pre_install_cmd', '')
    post_install_cmd     = data.get('post_install_cmd', '')
    image                = data.get('image', os.environ.get('CONTAINER_IMAGE', 'alpine/ansible:2.20.0'))
    
    logger.info(f"Node='{namespace}/{name}' Label='fairport.io/node=true' Action:'{reason}'")
    
    job_name = f"node-setup-{name}"
    job_manifest = {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {
            "name": job_name,
            "namespace": ssh_secret_namespace
        },
        "spec": {
            "ttlSecondsAfterFinished": 86400,
            "activeDeadlineSeconds": 600,
            "backoffLimit": 2,
            "template": {
                "spec": {
                    "hostNetwork": True,
                    "dnsPolicy": "ClusterFirstWithHostNet",
                    "restartPolicy": "Never",
                    "nodeSelector": {"node-role.kubernetes.io/control-plane": "true"},
                    "tolerations": [{ "operator": "Exists" }],
                    "containers": [{
                        "name": "provisioner",
                        "image": image,
                        "command": ["/bin/sh", "-c"],
                        "args": [
                            f"""
                            info () {{ echo "[$(date +%s)][INFO    ] $*" ; }}
                            crit () {{ echo "[$(date +%s)][CRITICAL] $*" >&2 ; }}

                            INSTALL_CMD=$(/usr/local/bin/fp-add-{node_type})
                            
                            info "SSH to {ip} to run setup"
                            ssh -o StrictHostKeyChecking=no -p {ssh_port} -i /etc/ssh-key/{ssh_secret_key} {ssh_user}@{ip} << EOSSH

if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
elif sudo -n true 2>&1; then
    SUDO="sudo"
else
    echo "Commands need to be run as root or with sudo"
    exit 1
fi

$SUDO /bin/sh << RUNCMD
{pre_install_cmd}
$INSTALL_CMD
{post_install_cmd}
RUNCMD

EOSSH
                            [ $? -ne 0 ] && crit "SSH connection failed" && exit 1
                            info "Done"
                            """
                        ],
                        "volumeMounts": [
                            {
                                "name": "ssh-key",
                                "mountPath": "/etc/ssh-key",
                                "readOnly": True
                            },
                            {
                                "name": "node-token",
                                "mountPath": "/var/lib/rancher/rke2/server/node-token",
                                "readOnly": True
                            },
                            {
                                "name": "usr-local-bin",
                                "mountPath": "/usr/local/bin",
                                "readOnly": True
                            }
                        ]
                    }],
                    "volumes": [
                        {
                            "name": "ssh-key",
                            "secret": {
                                "secretName": ssh_secret_name,
                                "defaultMode": 0o600
                            }
                        },
                        {
                            "name": "node-token",
                            "hostPath": {
                                "path": "/var/lib/rancher/rke2/server/node-token",
                                "type": "File"
                            }
                        },
                        {
                            "name": "usr-local-bin",
                            "hostPath": {
                                "path": "/usr/local/bin",
                                "type": "Directory"
                            }
                        }
                    ]
                }
            }
        }
    }

    try:
        batch_v1 = client.BatchV1Api()
        # Check if job exists, delete if necessary or skip
        try:
            batch_v1.delete_namespaced_job(job_name, ssh_secret_namespace, propagation_policy='Background')
            logger.info(f"Deleted previous job {job_name} in namespace {ssh_secret_namespace}")
        except client.exceptions.ApiException:
            pass # Job didn't exist

        batch_v1.create_namespaced_job(namespace=ssh_secret_namespace, body=job_manifest)
        logger.info(f"Job {job_name} created in {ssh_secret_namespace} to provision {ip}")
        
    except Exception as e:
        logger.error(f"Failed to create job: {e}")