from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel
from granbridge.events.models import DartHit

class ValidationResult(BaseModel):
    agreed: bool
    detected_bed: Optional[str] = None
    confidence: float = 1.0

class Validator(ABC):
    """Seam for cross-checking a BLE dart_hit against an independent (camera) detection."""
    @abstractmethod
    def validate(self, dart_hit: DartHit) -> ValidationResult:
        ...

class NoOpValidator(Validator):
    """Default: trusts the board. The seam a future CV validator implements."""
    def validate(self, dart_hit: DartHit) -> ValidationResult:
        return ValidationResult(agreed=True, detected_bed=dart_hit.bed, confidence=1.0)
