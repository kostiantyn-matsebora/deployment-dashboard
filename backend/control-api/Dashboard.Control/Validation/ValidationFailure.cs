namespace Dashboard.Control.Validation;

internal sealed record ValidationFailure(string Pointer, string Message);
