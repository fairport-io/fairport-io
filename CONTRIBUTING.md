# Contributing

## Training

Before contributing to this repository, each user must complete the [TRAINING.md](TRAINING.md) module.

## Documentation

Each application or chart should have its own `README.md` file with relevant information. 

If documentation requires things outside the scope of a single application, please place those docs inside a file in the `docs/` directory. For example, if you need to document how to authenticate with a provider, you could make a doc called `docs/AUTHENTICATE_WITH_GOOGLE.md` with specific directions.

## CI/CD

Builds and tests can be completed locally or in the CI/CD system. All builds using the `Makefile` are expected to be hermetic and only require `docker` (and docker build tools) to be installed.

The Makefile supports the following arguments:

| Command | Action |
| :--- | :--- |
| `make build` | Creates a container, builds artifacts inside the container specified in the `build` stage/target, and saves the container if the build is successful. |
| `make test` | Launches the container and runs the `test` stage/target of the Dockerfile. |
| `make deploy` | Uploads artifacts to the artifact registry and then runs the `deploy` stage/target of the Dockerfile. |
| `make clean` | Deletes the container on the local device. |

### Windows & Mac Users (Local Builds)

For Windows and Mac users who do not have Docker Desktop (which requires a paid commercial license for enterprise use), there are several free/open-source alternatives:

- Let the CI/CD system build and test for you.
- [Rancher Desktop](https://rancherdesktop.io/): Creates a VM and links the `docker` commands back to your machine.
- [Docker Remote Context](https://docs.docker.com/engine/manage-resources/contexts/): Use another machine to do the work for you.
- Use a Linux VM (locally via WSL2, VirtualBox, etc., or in a cloud provider).

## Application Layout

To understand how CI/CD works in this repository, it is helpful to understand our standard application layout:

```text
.
├── Makefile
├── README.md
├── CONTRIBUTING.md
└── apps
    └── example-app
        ├── Dockerfile
        ├── Makefile -> ../../Makefile
        ├── README.md
        └── VERSION
```

Each application folder must have:
1. A **`Makefile`** that is symlinked to the root `Makefile` for the CI/CD system. 
   *(To create this, run: `ln -s ../../Makefile Makefile` from inside your app folder).*
2. A **`VERSION`** file formatted using Semantic Versioning (X.Y.Z).
3. A **`README.md`** with information about the application.

## Updating Apps

> [!WARNING]
> When updating an app, you **must** update the `VERSION` file with a new semantic version number along with your application changes. CI/CD relies on this file to tag releases.

Follow standard [Semantic Versioning](https://semver.org/) rules when bumping your version:

| Type | Example | Description |
| :--- | :--- | :--- |
| **Major** | `1.0.0` -> `2.0.0` | Breaking changes (not backward compatible). |
| **Minor** | `0.1.0` -> `0.2.0` | New features added (backward compatible). |
| **Patch** | `0.0.1` -> `0.0.2` | Bug fixes (backward compatible). |

## Creating Apps

To quickly start on a new app, you can clone the example application and start working right away!

```shell
cp -r apps/example apps/<new-app-name>
rm apps/<new-app-name>/Makefile
ln -s Makefile apps/<new-app-name>/Makefile
```
