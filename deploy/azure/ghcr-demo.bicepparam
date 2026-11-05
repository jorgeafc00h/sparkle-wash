using './first-demo.bicep'

param location = 'eastus2'
param imageRef = 'ghcr.io/jorgeafc00h/sparklewash-api@sha256:1e9d8a41c90e05686f06c8c2821c21c98df36f42b1667f91481ccd08f13b8df6'
param registryServer = 'ghcr.io'
param registryUsername = readEnvironmentVariable('SPARKLEWASH_GHCR_USERNAME')
param registryPassword = readEnvironmentVariable('SPARKLEWASH_GHCR_READ_TOKEN')
