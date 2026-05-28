namespace Dashboard.Write.Validation;

internal sealed record ValidationFailure(string Pointer, string Message);
