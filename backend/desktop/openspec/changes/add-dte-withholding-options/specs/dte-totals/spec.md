# dte-totals — Delta

## ADDED Requirements

### Requirement: Optional FSE income-tax withholding
A Factura de Sujeto Excluido SHALL offer "Aplicar retención de renta (10%)", ON by default. When
OFF, the stored totals, the DTE resumen (`reteRenta` 0, `totalPagar` = total), the PDF and exports
SHALL carry no withholding.

#### Scenario: FSE for goods without withholding
- **WHEN** the user creates an FSE for $200.00 of goods and turns the withholding off
- **THEN** reteRenta is $0.00, total a pagar is $200.00 and MH accepts the document

#### Scenario: FSE default keeps withholding
- **WHEN** the user creates an FSE for $200.00 without touching the option
- **THEN** reteRenta is $20.00 and total a pagar is $180.00

### Requirement: IVA percepción 1%
When the company is an agente de percepción and the receptor is not a gran contribuyente, a CCF
whose gravado base is at least $100.00 SHALL carry ivaPerci1 = 1% of that base, added to total a
pagar; otherwise ivaPerci1 SHALL be 0.

#### Scenario: Agent sells to a regular taxpayer
- **WHEN** an agente de percepción issues a CCF with base $500.00 to a customer that is not a gran contribuyente
- **THEN** ivaPerci1 is $5.00, IVA $65.00 and total a pagar $570.00 in the totals panel, the DTE and the PDF

#### Scenario: Below the threshold or to a gran contribuyente
- **WHEN** the base is $99.99, or the customer is a gran contribuyente, or the company is not an agent
- **THEN** ivaPerci1 is $0.00
