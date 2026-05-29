#!/usr/bin/env python3

import os
import re
import kopf
import logging
from kubernetes import client, config

namespace = os.environ.get('NAMESPACE', 'default')
label_prefix = os.environ.get('LABEL_PREFIX', 'example.ai/')
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def authenticate():
    try:
        config.load_incluster_config()
        logger.info("Loaded in-cluster config.")
    except config.ConfigException:
        config.load_kube_config()
        logger.info("Loaded KUBECONFIG.")

def create_k8s_clients():
    batch_v1_client = client.BatchV1Api()
    return batch_v1_client

def make_kubernetes_safe_name(name):
    name = name.lower()
    name = re.sub(r'[^a-z0-9]+', '-', name)
    name = name.strip('-')
    return name[:63]

def has_label_prefix(prefix):
    def callback(old, new, **_):
        # Handle cases where 'new' is the full object body or just the labels
        # If 'metadata' key exists, it's the Body; otherwise treat as the labels dict
        new_labels = new.get('metadata', {}).get('labels', {}) if new and 'metadata' in new else (new or {})
        old_labels = old.get('metadata', {}).get('labels', {}) if old and 'metadata' in old else (old or {})

        # Calculate actual label changes
        changed = {k: new_labels[k] for k in new_labels if k not in old_labels or new_labels[k] != old_labels[k]}

        # Check if any changed label matches our prefix
        for key in changed:
            if key.startswith(prefix):
                return True

        return False
    return callback

def software_update_job(label_key, label_value, node_name):
    job_name = make_kubernetes_safe_name(f"update-{node_name}-{label_key}")
    logger.info(f"Creating Job '{job_name}' to update node '{node_name}' to software release '{label_value}'")
    job_manifest = {
      "apiVersion": "batch/v1",
      "kind": "Job",
      "metadata": {
        "name": job_name,
        "namespace": namespace
      },
      "spec": {
        "ttlSecondsAfterFinished": 180,
        "template": {
          "spec": {
            "nodeSelector": {
              "kubernetes.io/hostname": node_name
            },
            "hostPID": True,
            "hostNetwork": True,
            "restartPolicy": "Never",
            "containers": [{
              "name": "updater",
              "image": "ubuntu:24.04",
              "securityContext": {
                "privileged": True
              },
              "volumeMounts": [
                {
                  "name": "host-root",
                  "mountPath": "/host"
                }
              ],
              "command": [
                "/bin/sh", 
                "-c", 
                f"""
                nsenter -t 1 -m -u -i -n -p -- /bin/bash -c '
                echo "apt update...." && 
                sleep 10
                '
                """
              ]
            }],
            "volumes": [
              {
                "name": "host-root",
                "hostPath": {
                  "path": "/"
                }
              }
            ]
          }
        }
      }
    }

    # Create the Job (kubectl apply equivalent to create if it doesnt exist)
    try:
        batch_v1_client.create_namespaced_job(body=job_manifest, namespace=namespace)
        logger.info(f"Created Job '{job_name}'")
    except client.exceptions.ApiException as e:
        if e.status == 409:
            logger.info(f"Job '{job_name}' already exists. Skipping.")
        else:
            logger.error(f"Failed to create job: {e}")


# Watch for changes to nodes with labels starting with label_prefix
@kopf.on.field('', 'v1', 'nodes', field='metadata.labels', when=has_label_prefix(label_prefix))
def update_node(name, labels, old, new, logger, **kwargs):
    changed = {k: new[k] for k in new if k not in old or new[k] != old[k]}
    label_key, label_value = changed.popitem()
    if label_key == f'{label_prefix}software-release':
        software_update_job(label_key, label_value, name)

if __name__ == '__main__':
    authenticate()
    batch_v1_client = create_k8s_clients()
    kopf.run(clusterwide=True)
