"""
GS1 2D DataMatrix Barcode Parser
=================================
Parses GS1 standard healthcare barcodes containing Application Identifiers (AIs):
- (01) GTIN - Global Trade Item Number (14 digits)
- (17) Expiry Date (YYMMDD) -> Converted to YYYY-MM-DD
- (10) Batch / Lot Number (Variable length up to 20 chars)
- (21) Serial Number (Variable length up to 20 chars)

Supports both human-readable bracketed strings and raw scanner streams (with GS/FNC1 ASCII 29 delimiters).
"""

import re
from datetime import datetime
from typing import Optional, Dict, Any


def parse_gs1_barcode(barcode: str) -> Dict[str, Any]:
    """
    Parses a GS1 2D DataMatrix barcode string into structured components.
    Returns:
    {
        "gtin": str,
        "expiry_date": str (YYYY-MM-DD),
        "batch_number": str,
        "serial_number": Optional[str],
        "is_valid": bool,
        "raw": str,
        "error": Optional[str]
    }
    """
    if not barcode or not isinstance(barcode, str):
        return {
            "gtin": None,
            "expiry_date": None,
            "batch_number": None,
            "serial_number": None,
            "is_valid": False,
            "raw": barcode,
            "error": "Empty or non-string barcode provided",
        }

    raw = barcode.strip()
    result = {
        "gtin": None,
        "expiry_date": None,
        "batch_number": None,
        "serial_number": None,
        "is_valid": False,
        "raw": raw,
        "error": None,
    }

    # Case 1: Bracketed format (e.g. "(01)06281033745002(17)261231(10)LOT123(21)SN9999")
    if "(" in raw and ")" in raw:
        pattern = r"\((01|17|10|21)\)([^()]+)"
        matches = re.findall(pattern, raw)
        if matches:
            for ai, val in matches:
                val = val.strip()
                if ai == "01":
                    result["gtin"] = val
                elif ai == "17":
                    result["expiry_date"] = _format_yymmdd(val)
                elif ai == "10":
                    result["batch_number"] = val
                elif ai == "21":
                    result["serial_number"] = val

    # Case 2: Plain stream with FNC1 / ASCII 29 delimiters or standard prefixes
    else:
        # Replace non-printable GS / ASCII 29 with delimiter
        cleaned = raw.replace("\x1d", "<GS>")
        tokens = cleaned.split("<GS>")
        
        # Primary token often starts with 01
        for token in tokens:
            token = token.strip()
            if not token:
                continue
            
            # If token starts with 01 and has at least 14 digits after
            idx = 0
            while idx < len(token):
                if token[idx:idx+2] == "01" and len(token) >= idx + 16:
                    result["gtin"] = token[idx+2:idx+16]
                    idx += 16
                elif token[idx:idx+2] == "17" and len(token) >= idx + 8:
                    result["expiry_date"] = _format_yymmdd(token[idx+2:idx+8])
                    idx += 8
                elif token[idx:idx+2] == "10":
                    # Batch is variable length until next token or end
                    val = token[idx+2:]
                    result["batch_number"] = val
                    break
                elif token[idx:idx+2] == "21":
                    # Serial is variable length until next token or end
                    val = token[idx+2:]
                    result["serial_number"] = val
                    break
                else:
                    idx += 1

    # Validate essential fields for Saudi SFDA compliance (GTIN + Batch + Expiry)
    if result["gtin"] and result["batch_number"] and result["expiry_date"]:
        result["is_valid"] = True
    else:
        missing = []
        if not result["gtin"]:
            missing.append("GTIN (01)")
        if not result["batch_number"]:
            missing.append("Batch Number (10)")
        if not result["expiry_date"]:
            missing.append("Expiry Date (17)")
        result["is_valid"] = False
        result["error"] = f"Missing required GS1 identifiers: {', '.join(missing)}"

    return result


def _format_yymmdd(yymmdd: str) -> Optional[str]:
    """Converts YYMMDD to YYYY-MM-DD with Century 2000 handling."""
    if not yymmdd or len(yymmdd) != 6 or not yymmdd.isdigit():
        return None
    yy = int(yymmdd[:2])
    mm = int(yymmdd[2:4])
    dd = int(yymmdd[4:6])

    if not (1 <= mm <= 12):
        return None
    
    # If day is 00 in GS1 standard, it defaults to the last day of the month
    if dd == 0:
        import calendar
        year = 2000 + yy
        _, last_day = calendar.monthrange(year, mm)
        dd = last_day
    elif not (1 <= dd <= 31):
        return None

    year = 2000 + yy
    return f"{year:04d}-{mm:02d}-{dd:02d}"
