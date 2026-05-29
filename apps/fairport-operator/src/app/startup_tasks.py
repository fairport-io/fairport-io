import os
import logging
import subprocess
from kubernetes import client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

"""
Create a kube secret if it doesnt exist called node-join-cmd
which contains the node join command for adding a new node to the cluster.
"""
def create_node_join_cmd_secret():
    logger.info("Creating node join command secret if it doesnt exist")

    try:
        with open("/shared/fp-add-agent", "r") as f:
            fp_add_agent_cmd = f.read()

        with open("/shared/fp-add-server", "r") as f:
            fp_add_server_cmd = f.read()
    except:
        logger.error("Failed to read node join command files")
        return

    core_v1_api = client.CoreV1Api()
    namespace = os.environ.get('NAMESPACE', 'fairport')
    secret_name = "node-join-cmds"

    manifest = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {
            "name": secret_name,
            "namespace": namespace
        },
        "type": "Opaque",
        "stringData": {
            "agent": fp_add_agent_cmd.strip(),
            "server": fp_add_server_cmd.strip()
        }
    }

    try:
        core_v1_api.create_namespaced_secret(body=manifest, namespace=namespace)
        logger.info(f"Created secret '{secret_name}'")
    except client.exceptions.ApiException as e:
        if e.status == 409:
            logger.info(f"Secret '{secret_name}' already exists. Skipping.")
        else:
            logger.error(f"Failed to create secret: {e}")