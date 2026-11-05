targetScope = 'subscription'

@description('Region for the resource group and Container Apps environment.')
param location string

@description('A dedicated resource group for the disposable demo.')
param resourceGroupName string = 'rg-sparklewash-demo'

@description('Name for the public demo API.')
@minLength(2)
@maxLength(24)
param appName string = 'sparklewash-demo'

@description('Linux AMD64 OCI image pinned by digest.')
param imageRef string

@description('Private registry host. Leave empty for a public image.')
param registryServer string = ''

@description('Username of a pull-only registry credential.')
param registryUsername string = ''

@secure()
@description('Password or token for the pull-only registry credential.')
param registryPassword string = ''

resource demoGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
}

module demo './demo.bicep' = {
  name: '${appName}-demo'
  scope: demoGroup
  params: {
    appName: appName
    location: location
    imageRef: imageRef
    registryServer: registryServer
    registryUsername: registryUsername
    registryPassword: registryPassword
  }
}

output url string = demo.outputs.url
