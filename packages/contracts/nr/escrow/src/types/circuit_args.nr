// Wrappers around amazon_zktls_lib's input structs.
//
// The lib types (Contents, Hashes, ShipToHints) are pure Noir structs with
// no trait derives. Aztec private-function arguments must implement
// `Serialize`/`Deserialize` from aztec-nr's protocol_types so the ABI can
// pack them. Rather than push that dep into the (standalone) circuit lib,
// we mirror the shapes here with the right derives and convert at the
// call site.

use aztec::protocol::traits::{Deserialize, Serialize};
use amazon_zktls_lib::{
    Contents, Hashes, MAX_GRAND_TOTAL_LEN, MAX_PRODUCT_TITLE_LEN, MAX_SHIPMENT_STATUS_LEN,
    MAX_SHIP_TO_LEN, ShipToHints,
};

#[derive(Eq, Serialize, Deserialize)]
pub struct ContractHashes {
    pub shipment_status: [u8; 32],
    pub product_title: [u8; 32],
    pub ship_to: [u8; 32],
    pub grand_total: [u8; 32],
}

impl ContractHashes {
    pub fn to_lib(self) -> Hashes {
        Hashes {
            shipment_status: self.shipment_status,
            product_title: self.product_title,
            ship_to: self.ship_to,
            grand_total: self.grand_total,
        }
    }
}

#[derive(Eq, Serialize, Deserialize)]
pub struct ContractContents {
    pub shipment_status: BoundedVec<u8, MAX_SHIPMENT_STATUS_LEN>,
    pub product_title: BoundedVec<u8, MAX_PRODUCT_TITLE_LEN>,
    pub ship_to: BoundedVec<u8, MAX_SHIP_TO_LEN>,
    pub grand_total: BoundedVec<u8, MAX_GRAND_TOTAL_LEN>,
}

impl ContractContents {
    pub fn to_lib(self) -> Contents {
        Contents {
            shipment_status: self.shipment_status,
            product_title: self.product_title,
            ship_to: self.ship_to,
            grand_total: self.grand_total,
        }
    }
}

#[derive(Eq, Serialize, Deserialize)]
pub struct ContractShipToHints {
    pub offsets: [u32; 4],
    pub lens: [u32; 4],
}

impl ContractShipToHints {
    pub fn to_lib(self) -> ShipToHints {
        ShipToHints { offsets: self.offsets, lens: self.lens }
    }
}
