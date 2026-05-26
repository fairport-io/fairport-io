# Contributing

## CI/CD (Automatically)

 1. Update the chart version in `Chart.yaml`
```diff
- version: 0.0.X
+ version: 0.0.Y
```

 2. Make a pull request with your commit message specifying the `Makefile` in the chart directory.
```
git commit -am 'Add new feature and bump chart version to 1.2.3 --apply=charts/fairport/Makefile' && git push
```

## Manual

> [!NOTE]
> PLEASE USE THE CI/CD METHOD

> [!NOTE]
> The user must have push access to the GCR repository.

 1. Authenticate with GCR
```shell
gcloud auth print-access-token | helm registry login -u oauth2accesstoken --password-stdin https://gcr.io
```

 2. Update helm dependencies
```shell
helm dependency update
```

 3. Update the chart version in `Chart.yaml`
```diff
- version: 0.0.X
+ version: 0.0.Y
```

 4. Commit your changes
```shell
git commit -am 'Update chart from 0.0.X to 0.0.Y' && git push
```

 4. Package and push the chart
```shell
rm fairport-*.tgz
helm package .
helm push fairport-*.tgz oci://gcr.io/fairport-io
```
