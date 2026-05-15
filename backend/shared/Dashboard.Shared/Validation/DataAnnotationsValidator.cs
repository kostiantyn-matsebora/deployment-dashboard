using System.ComponentModel.DataAnnotations;

namespace Dashboard.Shared.Validation;

/// <summary>
/// Runs Data Annotations on a request DTO and converts failures into the
/// shape that ASP.NET Core's <c>ValidationProblemDetails</c> uses, so the
/// API can return <c>422 Unprocessable Entity</c> with a familiar body.
///
/// <para>FluentValidation is explicitly forbidden by the SAD; Data
/// Annotations alone cover every field on
/// <c>DeploymentEventRequest</c>.</para>
/// </summary>
public static class DataAnnotationsValidator
{
    public static (bool IsValid, Dictionary<string, string[]> Errors) Validate(object instance)
    {
        ArgumentNullException.ThrowIfNull(instance);

        var results = new List<ValidationResult>();
        var context = new ValidationContext(instance);
        var isValid = Validator.TryValidateObject(
            instance, context, results, validateAllProperties: true);

        if (isValid) return (true, new Dictionary<string, string[]>());

        var errors = new Dictionary<string, List<string>>();
        foreach (var r in results)
        {
            var members = r.MemberNames.Any() ? r.MemberNames : new[] { string.Empty };
            foreach (var m in members)
            {
                if (!errors.TryGetValue(m, out var list))
                {
                    list = new List<string>();
                    errors[m] = list;
                }
                list.Add(r.ErrorMessage ?? "invalid");
            }
        }

        return (false, errors.ToDictionary(kv => kv.Key, kv => kv.Value.ToArray()));
    }
}
