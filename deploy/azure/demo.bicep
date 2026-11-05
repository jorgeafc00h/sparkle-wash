targetScope = 'resourceGroup'

@description('A unique name for the disposable SparkleWash app.')
@minLength(2)
@maxLength(24)
param appName string = 'sparklewash-demo'

param location string = resourceGroup().location

@description('Linux AMD64 OCI image pinned by digest.')
param imageRef string

@description('Private registry host. Leave empty for a public image.')
param registryServer string = ''

@description('Username of a pull-only registry credential.')
param registryUsername string = ''

@secure()
@description('Password or token for the pull-only registry credential.')
param registryPassword string = ''

@description('Existing storage account name. Leave empty for disposable data.')
param storageAccountName string = ''

@description('Existing SMB file share dedicated to this application.')
param storageShareName string = ''

@secure()
@description('Access key for the existing storage account.')
param storageAccountKey string = ''

@secure()
@description('Optional Npgsql connection string for the migrated operational stores.')
param postgresConnection string = ''

@description('Google OAuth client IDs accepted by the API.')
param googleClientIds string = ''

@secure()
@description('Semicolon-delimited subject-to-role mappings for default-site staff.')
param staffRoles string = ''

@secure()
@description('Optional shared ingest key for the default site.')
param ingestKey string = ''

@description('Allowed browser origins for a separately hosted workboard.')
param corsOrigins string = ''

var mountData = !empty(storageAccountName)
var usePostgres = !empty(postgresConnection)
var volumeName = 'api-data'

resource environment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: '${appName}-env'
  location: location
  properties: {
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource dataStorage 'Microsoft.App/managedEnvironments/storages@2025-07-01' = if (mountData) {
  parent: environment
  name: volumeName
  properties: {
    azureFile: {
      accountName: storageAccountName
      accountKey: storageAccountKey
      shareName: storageShareName
      accessMode: 'ReadWrite'
    }
  }
}

resource app 'Microsoft.App/containerApps@2025-07-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      secrets: concat(usePostgres ? [
        {
          name: 'postgres-connection'
          value: postgresConnection
        }
      ] : [], empty(staffRoles) ? [] : [
        {
          name: 'staff-roles'
          value: staffRoles
        }
      ], empty(ingestKey) ? [] : [
        {
          name: 'ingest-key'
          value: ingestKey
        }
      ], empty(registryServer) ? [] : [
        {
          name: 'registry-password'
          value: registryPassword
        }
      ])
      registries: empty(registryServer) ? [] : [
        {
          server: registryServer
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ]
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
      volumes: mountData ? [
        {
          name: volumeName
          storageType: 'AzureFile'
          storageName: dataStorage!.name
          mountOptions: 'uid=1654,gid=1654,dir_mode=0770,file_mode=0660'
        }
      ] : []
      containers: [
        {
          name: 'api'
          image: imageRef
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          volumeMounts: mountData ? [
            {
              volumeName: volumeName
              mountPath: '/app/data'
            }
          ] : []
          env: concat([
            {
              name: 'SPARKLEWASH_REGISTRATION_OPEN'
              value: 'false'
            }
            {
              name: 'SPARKLEWASH_GOOGLE_CLIENT_ID'
              value: googleClientIds
            }
            {
              name: 'SPARKLEWASH_CORS_ORIGINS'
              value: corsOrigins
            }
          ], empty(staffRoles) ? [] : [
            {
              name: 'SPARKLEWASH_STAFF_ROLES'
              secretRef: 'staff-roles'
            }
          ], empty(ingestKey) ? [] : [
            {
              name: 'SPARKLEWASH_INGEST_KEY'
              secretRef: 'ingest-key'
            }
          ], usePostgres ? [
            {
              name: 'SPARKLEWASH_SESSION_POSTGRES'
              secretRef: 'postgres-connection'
            }
            {
              name: 'SPARKLEWASH_POSTGRES_DIRECTORY'
              value: 'true'
            }
            {
              name: 'SPARKLEWASH_POSTGRES_DEVICES'
              value: 'true'
            }
            {
              name: 'SPARKLEWASH_POSTGRES_WORKFLOW'
              value: 'true'
            }
            {
              name: 'SPARKLEWASH_POSTGRES_INVENTORY'
              value: 'true'
            }
          ] : [])
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                port: 8080
                path: '/healthz'
              }
              periodSeconds: 15
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                port: 8080
                path: '/readyz'
              }
              periodSeconds: 15
              failureThreshold: 3
            }
          ]
        }
      ]
    }
  }
}

output url string = 'https://${app.properties.configuration.ingress.fqdn}'
