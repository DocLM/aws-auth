const AWS = require('aws-sdk')
const os = require('os')
const fs = require('fs')
const { globalConfig } = require('../config')
const { AWSUtils, ConfUtils, Utils } = require('../helpers')

/**
 * CLI 'login' command handler.
 */
async function login() {
    const [cliConfig, passphrase] = await ConfUtils.loadCliConfig()
    const profiles = Utils.lodashGet(cliConfig, 'profiles', [])

    /* load profile */

    if (!profiles.length) {
        console.log(`CLI configuration has no saved profiles, use "config" command to add one`.red)
        process.exit(1)
    }

    const { selection } = await Utils.prompts({
        type: 'select',
        name: 'selection',
        message: '(1/5) Select a profile to use',
        choices: profiles.map((p, i) => ({ title: p.name, value: i })),
    })

    const profile = cliConfig.profiles[selection]
    const { environments } = profile

    if (!environments.length) {
        console.log(`This profile has no saved environments, use "config" command to add one`.red)
        process.exit(1)
    }

    AWS.config.update(profile.awsCredentials)
    const STS = new AWS.STS()

    /* gather auth parameters (env, role, mfa code, etc.) */

    const { environment } = await Utils.prompts({
        type: 'select',
        name: 'environment',
        message: '(2/5) Choose an environment to log into',
        choices: environments.map((env) => ({ title: env.name, value: env })),
    })
    const { role } = await Utils.prompts({
        type: 'select',
        name: 'role',
        message: '(3/5) Choose an IAM role to use',
        choices: environment.roles.map((name) => ({ title: name, value: name })),
    })
    const { duration } = await Utils.prompts({
        type: 'number',
        name: 'duration',
        message: '(4/5) Specify session duration (in hours, 1-12)',
        initial: 1,
        min: 1,
        max: 12,
    })
    const { name: envName, accountId, region } = environment
    const roleToAssumeArn = AWSUtils.constructRoleArn(accountId, role)

    const { Account: HubAccountId, Arn: UserArn } = await STS.getCallerIdentity().promise()
    const username = UserArn.split('/').pop()
    const { mfaCode } = await Utils.prompts({
        type: 'text',
        name: 'mfaCode',
        message: '(5/5) Enter your MFA code',
    })

    /* authenticate with aws */

    console.log(`Authenticating into "${envName}" environment as "${role}"...`.yellow)
    const stsParams = {
        RoleArn: roleToAssumeArn,
        RoleSessionName: `${os.userInfo().username}-${username}-${envName}-${role}-${Date.now()}`,
        SerialNumber: AWSUtils.constructMfaArn(HubAccountId, username),
        TokenCode: mfaCode,
        DurationSeconds: duration * 3600,
    }

    let Credentials = null
    try {
        ;({ Credentials } = await STS.assumeRole(stsParams).promise())
    } catch (error) {
        if (error.message.includes('Duration')) {
            console.log(`Specified session duration exceeds the maximum allowed limit set on the '${role}' role`.red)
            process.exit(1)
        }
        if (error.message.includes('MultiFactorAuthentication') || error.message.includes('MFA')) {
            console.log('Wrong MFA code. Please try again'.red)
            process.exit(1)
        }
        if (error.code === 'AccessDenied') {
            console.log(
                "Could not assume the selected role. Make sure it's name is correct in the CLI config and that your IAM user (HUB account entity) is allowed to assume it"
                    .red,
            )
            console.log(`${error.message}`.red)
            process.exit(1)
        }
        throw error
    }
    const { AccessKeyId, SecretAccessKey, SessionToken, Expiration } = Credentials

    /* save aws keys to disk */

    const sessions = Utils.lodashGet(cliConfig, 'sessions', [])
    const newSession = {
        name: `${profile.name}/${envName}/${role}`,
        region,
        keyId: AccessKeyId,
        key: SecretAccessKey,
        sessionToken: SessionToken,
        expiry: Expiration,
    }
    const existingEntryIdx = sessions.findIndex((item) => item.name === newSession.name)
    if (existingEntryIdx > -1) {
        sessions.splice(existingEntryIdx, 1, newSession)
    } else {
        sessions.push(newSession)
    }
    cliConfig.sessions = sessions
    await ConfUtils.saveCliConfig(cliConfig, passphrase)

    if (Utils.getFeatureFlag('INSECURE_USE_AWS_CREDENTIALS_FILE').value) {
        const { credConfig, config } = AWSUtils.constructAwsConfig(newSession)
        fs.writeFileSync(globalConfig.awsCredPath, credConfig)
        fs.writeFileSync(globalConfig.awsConfigPath, config)
    }

    console.log('Authentication successful'.green)
}

module.exports = { login }
