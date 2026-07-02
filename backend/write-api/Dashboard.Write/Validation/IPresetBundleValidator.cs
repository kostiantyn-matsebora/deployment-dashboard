using Dashboard.Write.Contracts;

namespace Dashboard.Write.Validation;

internal interface IPresetBundleValidator
{
    IReadOnlyList<ValidationFailure> Validate(PresetBundle bundle);
}
