"""
ZATCA Phase 2 E-Invoicing & UBL 2.1 XML Generator
==================================================
Implements ZATCA (Zakat, Tax and Customs Authority) Phase 2 compliance standards:
- UBL 2.1 Standard XML Invoice / Credit Note generation
- Canonical SHA-256 Digest Hashing
- 9-Tag TLV Base64 QR Code Encoding (Tags 1-5 Phase 1, Tags 6-9 Phase 2 Cryptographic Elements)
"""

import base64
import hashlib
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
import xml.etree.ElementTree as ET


def generate_zatca_tlv_qr(
    seller_name: str,
    vat_number: str,
    timestamp: str,
    total_amount: str,
    vat_amount: str,
    xml_hash: Optional[str] = None,
    ecdsa_signature: Optional[str] = None,
    public_key: Optional[str] = None,
    stamp_signature: Optional[str] = None,
) -> str:
    """
    Generates a Base64-encoded TLV (Tag-Length-Value) string compliant with ZATCA Phase 1 & Phase 2:
    - Tag 1: Seller Name
    - Tag 2: VAT Registration Number
    - Tag 3: Timestamp (YYYY-MM-DDTHH:MM:SSZ)
    - Tag 4: Total Amount (with VAT)
    - Tag 5: Total VAT Amount
    - Tag 6: Invoice XML SHA-256 Hash (Phase 2)
    - Tag 7: ECDSA Signature (Phase 2)
    - Tag 8: ECDSA Public Key (Phase 2)
    - Tag 9: Cryptographic Stamp Signature (Phase 2)
    """
    tags = [
        (1, seller_name.encode("utf-8")),
        (2, vat_number.encode("utf-8")),
        (3, timestamp.encode("utf-8")),
        (4, str(total_amount).encode("utf-8")),
        (5, str(vat_amount).encode("utf-8")),
    ]

    if xml_hash:
        tags.append((6, xml_hash.encode("utf-8")))
    if ecdsa_signature:
        tags.append((7, ecdsa_signature.encode("utf-8")))
    if public_key:
        tags.append((8, public_key.encode("utf-8")))
    if stamp_signature:
        tags.append((9, stamp_signature.encode("utf-8")))

    tlv_bytes = bytearray()
    for tag_num, val_bytes in tags:
        tlv_bytes.append(tag_num)
        tlv_bytes.append(len(val_bytes))
        tlv_bytes.extend(val_bytes)

    return base64.b64encode(tlv_bytes).decode("ascii")


def generate_ubl_invoice_xml(
    invoice_number: str,
    uuid_str: str,
    issue_date: str,
    issue_time: str,
    seller: Dict[str, Any],
    buyer: Optional[Dict[str, Any]],
    items: List[Dict[str, Any]],
    subtotal: float,
    vat_total: float,
    total: float,
    previous_invoice_hash: Optional[str] = None,
    document_type: str = "388",  # 388 = Standard/Simplified Invoice, 381 = Credit Note
) -> str:
    """
    Constructs a standard UBL 2.1 XML document structure for ZATCA Phase 2.
    """
    ns = {
        "xmlns": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
        "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
        "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    }

    root = ET.Element("Invoice", ns)

    # Header elements
    cbc_id = ET.SubElement(root, "cbc:ID")
    cbc_id.text = invoice_number

    cbc_uuid = ET.SubElement(root, "cbc:UUID")
    cbc_uuid.text = uuid_str

    cbc_date = ET.SubElement(root, "cbc:IssueDate")
    cbc_date.text = issue_date

    cbc_time = ET.SubElement(root, "cbc:IssueTime")
    cbc_time.text = issue_time

    cbc_type = ET.SubElement(root, "cbc:InvoiceTypeCode", {"name": "0200000"})  # Simplified Tax Invoice
    cbc_type.text = document_type

    cbc_currency = ET.SubElement(root, "cbc:DocumentCurrencyCode")
    cbc_currency.text = "SAR"

    # Previous Invoice Hash (Chaining)
    if previous_invoice_hash:
        doc_ref = ET.SubElement(root, "cac:AdditionalDocumentReference")
        doc_id = ET.SubElement(doc_ref, "cbc:ID")
        doc_id.text = "PIH"
        attachment = ET.SubElement(doc_ref, "cac:Attachment")
        binary_obj = ET.SubElement(attachment, "cbc:EmbeddedDocumentBinaryObject", {"mimeCode": "text/plain"})
        binary_obj.text = previous_invoice_hash

    # Accounting Supplier Party
    supplier = ET.SubElement(root, "cac:AccountingSupplierParty")
    party = ET.SubElement(supplier, "cac:Party")
    party_name = ET.SubElement(party, "cac:PartyLegalEntity")
    reg_name = ET.SubElement(party_name, "cbc:RegistrationName")
    reg_name.text = seller.get("name", "PharmaFlow Demo")
    tax_scheme = ET.SubElement(party, "cac:PartyTaxScheme")
    company_id = ET.SubElement(tax_scheme, "cbc:CompanyID")
    company_id.text = seller.get("vat_number", "311111111111113")

    # Accounting Customer Party (Optional for simplified, required for B2B)
    if buyer and buyer.get("name"):
        customer = ET.SubElement(root, "cac:AccountingCustomerParty")
        c_party = ET.SubElement(customer, "cac:Party")
        c_name = ET.SubElement(c_party, "cac:PartyLegalEntity")
        c_reg_name = ET.SubElement(c_name, "cbc:RegistrationName")
        c_reg_name.text = buyer["name"]
        if buyer.get("vat_number"):
            c_tax = ET.SubElement(c_party, "cac:PartyTaxScheme")
            c_comp = ET.SubElement(c_tax, "cbc:CompanyID")
            c_comp.text = buyer["vat_number"]

    # Tax Total
    tax_total_elem = ET.SubElement(root, "cac:TaxTotal")
    tax_amount = ET.SubElement(tax_total_elem, "cbc:TaxAmount", {"currencyID": "SAR"})
    tax_amount.text = f"{vat_total:.2f}"

    # Legal Monetary Total
    monetary = ET.SubElement(root, "cac:LegalMonetaryTotal")
    line_ext = ET.SubElement(monetary, "cbc:LineExtensionAmount", {"currencyID": "SAR"})
    line_ext.text = f"{subtotal:.2f}"
    tax_inc = ET.SubElement(monetary, "cbc:TaxInclusiveAmount", {"currencyID": "SAR"})
    tax_inc.text = f"{total:.2f}"
    payable = ET.SubElement(monetary, "cbc:PayableAmount", {"currencyID": "SAR"})
    payable.text = f"{total:.2f}"

    # Invoice Lines
    for idx, item in enumerate(items, 1):
        line = ET.SubElement(root, "cac:InvoiceLine")
        l_id = ET.SubElement(line, "cbc:ID")
        l_id.text = str(idx)
        l_qty = ET.SubElement(line, "cbc:InvoicedQuantity", {"unitCode": "PCE"})
        l_qty.text = str(item.get("quantity", 1))
        l_ext = ET.SubElement(line, "cbc:LineExtensionAmount", {"currencyID": "SAR"})
        l_ext.text = f"{float(item.get('unit_price', 0)) * int(item.get('quantity', 1)):.2f}"

        item_elem = ET.SubElement(line, "cac:Item")
        item_name = ET.SubElement(item_elem, "cbc:Name")
        item_name.text = item.get("name_en") or item.get("medicine_id") or "Pharmaceutical Item"

        price_elem = ET.SubElement(line, "cac:Price")
        price_amount = ET.SubElement(price_elem, "cbc:PriceAmount", {"currencyID": "SAR"})
        price_amount.text = f"{float(item.get('unit_price', 0)):.2f}"

    xml_str = ET.tostring(root, encoding="utf-8", xml_declaration=True).decode("utf-8")
    return xml_str


def compute_zatca_invoice_hash(xml_content: str) -> str:
    """Computes standard SHA-256 digest of the XML invoice payload."""
    if isinstance(xml_content, str):
        xml_bytes = xml_content.encode("utf-8")
    else:
        xml_bytes = xml_content
    return hashlib.sha256(xml_bytes).hexdigest()
