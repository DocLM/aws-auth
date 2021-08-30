const { ConfUtils, Utils } = require('../helpers')
const { CLI_NAME_UPPER } = require('../config')

const Action = Object.freeze({
    ENCRYPT_CONFIG: Symbol('ENCRYPT_CONFIG'),
    DECRYPT_CONFIG: Symbol('DECRYPT_CONFIG'),
    CHANGE_PASSCODE: Symbol('CHANGE_PASSCODE'),
})

/**
 * CLI 'crypto' command handler.
 */
async function crypto() {
    const cliConfig = ConfUtils.loadConfigAsIs()
    const isEncrypted = ConfUtils.isEncrypted(cliConfig)

    /* build the menu */

    const choices = []
    if (isEncrypted) {
        choices.push({ title: 'Decrypt the configuration file', value: Action.DECRYPT_CONFIG })
        choices.push({ title: 'Change config file passphrase', value: Action.CHANGE_PASSCODE })
    } else {
        choices.push({ title: 'Encrypt the configuration file', value: Action.ENCRYPT_CONFIG })
    }
    const { selection } = await Utils.prompts({
        type: 'select',
        name: 'selection',
        message: 'What do you want to do?',
        choices,
    })

    /* handle encrypt action */

    if (selection === Action.ENCRYPT_CONFIG) {
        const secretKey = await ConfUtils.getNewEncryptionKey()
        const encrypted = ConfUtils.encryptConfig(cliConfig, secretKey)
        ConfUtils.saveConfigAsIs(encrypted)
    }

    /* handle decrypt action */

    if (selection === Action.DECRYPT_CONFIG) {
        const [decrypted] = await ConfUtils.decryptConfigWithRetry(cliConfig)
        ConfUtils.saveConfigAsIs(decrypted)
    }

    /* handle create or edit actions */

    if (selection === Action.CHANGE_PASSCODE) {
        const [decrypted] = await ConfUtils.decryptConfigWithRetry(cliConfig)
        const newSecretKey = await ConfUtils.getNewEncryptionKey()
        const encrypted = ConfUtils.encryptConfig(decrypted, newSecretKey)
        ConfUtils.saveConfigAsIs(encrypted)
    }

    console.log('Operation successful!'.green)
}

module.exports = { crypto }
