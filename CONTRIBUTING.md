# contributing

Each application should have its own `README.md` file with information about the application.

Each application should have its own `Makefile` symlinked to the root `Makefile` for the CI/CD system.

Update the `VERSION` files if you are making changes to allow applications to continue using existing code for backwards compatiabilty.  In each app there should be a `VERSION` file following symantic versioning (X.Y.Z).  If your app is part of the dmatrix helm chart, consider updating the `image:` as well.

Builds can be copmleted locally or in the CI/CD system.  All builds using the `Makefile` are hermetic and only require `docker` to be installed.  For arm64 Macs, if docker isn't installed then Rancher Desktop is a good option (https://rancherdesktop.io/) it will install a Kubernetes Cluster on a Linux VM which can be configured to use Rosetta virtualization and Docker so you can run `docker` natively on Appple Silicon without licensing issues.  Altenatives like Podman can also work.

The Makefile supports the following arguments:

| Command       | Action |
| -             | -      |
| `make build`  | Creates a container and builds artifacts inside the container specified in the `build` stage/target and saves the container if the build is successful |
| `make test`   | Launches the container and runs the `test` stage/target of the Dockerfile |
| `make deploy` | Uploads artifacts to the artifact registry and then runs the `deploy` stage/target of the Dockerfile |
| `make clean`  | Deletes the container on the local device |
