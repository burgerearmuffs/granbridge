import "@testing-library/jest-dom";

// jsdom has no canvas implementation; Celebration's confetti calls getContext.
// Return null (legal per spec) so components fall back gracefully instead of
// surfacing an unhandled "Not implemented" error in the vitest summary.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
