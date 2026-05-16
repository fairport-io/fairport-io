# RKE2 Troubleshooting

## Resore Cluster From Snapshot

These steps will restore a 3-node rke2 cluster from snapshots.

| Step | Target Control-Plane Nodes | Action | Command |
| :--- | :--- | :--- | :--- |
| **1** | 1, 2, 3 | Stop RKE2 service | `systemctl stop rke2-server` |
| **2** | 1, 2, 3 | Backup current DB | `cp -r /var/lib/rancher/rke2/server/db /var/lib/rancher/rke2/server/db.bak.$(date +%s)` |
| **3** | 1       | Identify a snapshot to restore from (when the cluster was last in a good state) | `ls -ltr /var/lib/rancher/rke2/server/db/snapshots/` |
| **4** | 1       | Comment out `server` in the rke2 config | `sed -i "s/^server: /#server: /" /etc/rancher/rke2/config.yaml` |
| **5** | 1       | Restore from snapshot | `rke2 server --cluster-reset --cluster-reset-restore-path=/var/lib/rancher/rke2/server/db/snapshots/<snapshot-name>` |
| **6** | 1       | Start RKE2 service | `systemctl start rke2-server` |
| **7** | 2, 3    | Delete old DB directory | `rm -rf /var/lib/rancher/rke2/server/db` |
| **8** | 2, 3    | Verify config | Ensure `server` in `/etc/rancher/rke2/config.yaml` points to control-plane 1 |
| **9** | 2, 3    | Start RKE2 service | `systemctl start rke2-server` |
