@{
    # Suppress rules that do not apply to hook scripts.
    ExcludeRules = @(
        # Collection-returning functions legitimately use plural nouns.
        'PSUseSingularNouns',
        # Hook scripts are not interactive cmdlets — ShouldProcess (-WhatIf/-Confirm) is not applicable.
        'PSUseShouldProcessForStateChangingFunctions',
        # Cross-platform PS 7+ scripts do not require a UTF-8 BOM; BOM can break Linux tooling.
        'PSUseBOMForUnicodeEncodedFile'
    )
}
