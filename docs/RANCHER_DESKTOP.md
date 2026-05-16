# Rancher Desktop

Rancher desktop is a lightweight cross-platform (Mac, Windows, Linux) kubernetes distribution.  It's easy to install and get started with Kubernetes development.  It has additional features like open source licensed docker for container development.

## Features

- Fully functional kubernetes distribution
- Run docker on any Mac, Windows, or Linux machine
- AMD64 or ARM64 Archtectures
- Easy cluster reset

## Installation

Follow the installation documentation here: https://rancherdesktop.io/

After installation you can immediately start using `kubectl` in your machine's shell, but you should also review the [Fairport Development Configuration](#fairport-development-configuration) section below:

## Fairport Development Configuration

Ensure that your development environment is setup to use standard Fairport processes.  Start by going to "Preferences" in the Rancher Desktop app:

<img width="500" alt="image" src="https://github.com/user-attachments/assets/95390f37-2dcf-43a8-83ba-194ff4919547" />

### Virtual Machine

In the virtual machine tab under "Hardware", use a minimum of 8GB of memory 2 CPUs.

<img width="500" alt="image" src="https://github.com/user-attachments/assets/40528e57-d149-44c4-b273-d94d905032e3" />

In the virtual machine tab under "Emulation", use the VZ Virtual Machine type for Mac and check the "Enable Rosetta support" checkbox.

<img width="500" alt="image" src="https://github.com/user-attachments/assets/21aefba0-87a7-4ee1-91eb-f6155479cd60" />

### Container Engine

Use dockerd as the container engine and you will be able to use docker on your development machine!  You can also use containerd if you have knowledge of how to use nerdctl.

<img width="500" alt="image" src="https://github.com/user-attachments/assets/11270dfb-0a2a-4db7-972c-b2d2272f0698" />

### Reset

If at any point you want to reset your cluster back to a completely new Kubernetes cluster, it's a very simple and only takes one minute!

On the "Troubleshooting" tab select "Reset Kubernetes" and then click "Reset"

<img width="500" alt="image" src="https://github.com/user-attachments/assets/3a11f5ea-3f1d-4806-89a6-94a776b267ad" />
