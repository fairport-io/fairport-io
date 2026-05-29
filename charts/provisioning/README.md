# provisioning

Helm wrapper for [Tinkerbell](https://tinkerbell.org) that adds SSH key generation, OS image caching, and automated Tinkerbell workflow/template object management for bare-metal provisioning.

## DHCP Configurations

### dnsmasq

```
# ==========================================
# 1. DHCP & Network Settings
# ==========================================
interface=eth0                        # Replace with your actual network interface (e.g., eno1, eth1)
bind-interfaces                       # Only listen on the specified interface
dhcp-range=10.1.1.100,10.1.1.200,12h  # The IP pool to hand out to bare-metal machines
dhcp-option=3,10.1.1.1                # Default Gateway / Router IP
dhcp-option=6,1.1.1.1,8.8.8.8         # DNS Servers

# ==========================================
# 2. Tinkerbell PXE Boot Process
# ==========================================

# Create a tag named "tinkerbell" if the DHCP User-Class (Option 77) is "Tinkerbell"
dhcp-match=tinkerbell, option:user-class, Tinkerbell

# STEP 1: INITIAL BOOT
# If the machine is NOT tagged "tinkerbell", it means it just powered on.
# Send it the iPXE bootloader over TFTP.
# (10.1.1.2 is the IP of your Tinkerbell Smee server hosting TFTP).
dhcp-boot=tag:!tinkerbell, ipxe.efi, none, 10.1.1.2

# STEP 2: iPXE BOOT
# If the machine IS tagged "tinkerbell", it means iPXE is now running.
# Hand it the HTTP URL to download the Tinkerbell workflow.
dhcp-boot=tag:tinkerbell, http://10.1.1.2:8541/ipxe/script/${net0/mac}/auto.ipxe

# ==========================================
# 3. Troubleshooting
# ==========================================
# Logs exactly what DHCP options are being requested and sent.
# Highly recommended for debugging PXE boot loops.
log-dhcp
```


