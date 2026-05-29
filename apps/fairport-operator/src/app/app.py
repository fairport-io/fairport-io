#!/usr/bin/env python3

import kopf
import logging
from kubernetes import config
import manage_node
import startup_tasks

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def authenticate():
    try:
        config.load_incluster_config()
        logger.info("Loaded in-cluster config.")
    except config.ConfigException:
        config.load_kube_config()
        logger.info("Loaded KUBECONFIG.")

@kopf.on.login(retries=3)
def login(**kwargs):
    return kopf.login_with_kubeconfig(**kwargs) or kopf.login_with_service_account(**kwargs)

if __name__ == '__main__':
    authenticate()
    startup_tasks.create_node_join_cmd_secret()
    kopf.run(clusterwide=True)
