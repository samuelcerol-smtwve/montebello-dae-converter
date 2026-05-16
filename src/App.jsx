import { useState, useEffect } from 'react';

// =============================================================================
// DAE/EMCS Converter — Montebello Suite
// Convertit factures Akanea (XML) → JSON Douane + XML Akanea enrichi
// 4 cas: Local/Export × Bouteilles/Vrac
// =============================================================================

const COULEURS = {
  primaire: '#7B1C1C',
  cta: '#962824',
  gradient: 'linear-gradient(135deg, #4a0e0e 0%, #5c1515 50%, #4a0e0e 100%)',
};

// Pays UE pour détection local vs export
const PAYS_UE = ['FR', 'DE', 'IT', 'ES', 'BE', 'NL', 'LU', 'PT', 'AT', 'IE', 'FI', 'SE', 'DK', 'PL', 'CZ', 'SK', 'HU', 'SI', 'HR', 'RO', 'BG', 'EE', 'LV', 'LT', 'MT', 'CY', 'GR'];

// Codes destination douane
const DESTINATION_TYPES = {
  '1': 'Entrepôt fiscal (local)',
  '2': 'Destinataire enregistré',
  '3': 'Destinataire temporaire',
  '4': 'Livraison directe',
  '5': 'Destinataire exonéré',
  '6': 'Exportation',
  '8': 'Destination inconnue',
};

// Modes de transport
const MODES_TRANSPORT = {
  '1': 'Maritime',
  '2': 'Train',
  '3': 'Route',
  '4': 'Aérien',
  '5': 'Postal',
  '7': 'Installations fixes',
  '8': 'Voies navigables intérieures',
};

// Codes CN principaux
const CN_CODES = {
  '22084011': 'Rhum agricole en vrac >2L (cuves, IBC, fûts)',
  '22084039': 'Rhum bouteilles ≤2L (générique)',
  '22084051': 'Rhum agricole IG bouteilles ≤2L',
  '22084099': 'Autres rhums',
};

// Types de colis (codes officiels douane GAMREF)
const KINDS_OF_PACKAGES = {
  'CT': 'Carton',
  'BX': 'Boîte / caisse',
  'CS': 'Caisse',
  'PK': 'Colis',
  'PT': 'Pot',
  'BO': 'Bouteille (verre)',
  'BJ': 'Bouteille (plastique)',
  'CR': 'Casier',
  'PA': 'Paquet',
  'PU': 'Plateau',
  // Conditionnements vrac (indénombrables : pas de NumberOfPackages)
  'VL': 'Vrac liquide (cuve / citerne)',
  'VQ': 'Vrac liquide (gaz liquéfié)',
  'VG': 'Vrac gaz',
  'VR': 'Vrac solide',
  'VY': 'Vrac granulaire',
  // Contenants spécifiques vrac (dénombrables)
  'IB': 'IBC (1000 L)',
  'DR': 'Fût (drum)',
  'BA': 'Tonneau / baril',
  'JR': 'Jarre',
  'CY': 'Bonbonne',
  'CI': 'Bidon (canister)',
};

// =============================================================================
// CALCULATEUR DE POIDS
// =============================================================================

// Catalogue de contenants avec tare en kg
const CONTENANTS_INITIAUX = {
  // Bouteilles individuelles (tare unitaire en kg)
  'bouteille_70cl':       { libelle: 'Bouteille verre 70cl vide',     tare: 0.500, type: 'unite' },
  'bouteille_100cl':      { libelle: 'Bouteille verre 1L vide',        tare: 0.600, type: 'unite' },
  'bouteille_50cl':       { libelle: 'Bouteille verre 50cl vide',      tare: 0.400, type: 'unite' },
  // Cartons (tare carton, hors bouteilles)
  'carton_12x70cl':       { libelle: 'Carton 12×70cl (carton seul)',   tare: 0.500, type: 'carton' },
  'carton_12x100cl':      { libelle: 'Carton 12×1L (carton seul)',     tare: 0.700, type: 'carton' },
  'carton_6x70cl':        { libelle: 'Carton 6×70cl (carton seul)',    tare: 0.400, type: 'carton' },
  'caisse_bois_6':        { libelle: 'Caisse bois 6 bouteilles',       tare: 1.500, type: 'carton' },
  // Vrac
  'ibc_1000':             { libelle: 'IBC 1000L vide',                 tare: 65,    type: 'vrac' },
  'fut_inox_200':         { libelle: 'Fût inox 200L',                  tare: 25,    type: 'vrac' },
  'fut_inox_1000':        { libelle: 'Fût inox 1000L',                 tare: 80,    type: 'vrac' },
  'fut_bois_220':         { libelle: 'Fût bois (chêne) 220L',          tare: 55,    type: 'vrac' },
  'citerne':              { libelle: 'Citerne (saisie manuelle)',      tare: 0,     type: 'vrac' },
  'aucun':                { libelle: 'Pas de contenant / déjà compté', tare: 0,     type: 'autre' },
};

// Calcul densité rhum selon degré
// Formule simplifiée précise à ±0,5% : ρ = 1 - (°/100) × 0,211
// (eau pure = 1, éthanol pur à 100° = 0,789)
function calculerDensite(degre) {
  const d = parseFloat(degre);
  if (isNaN(d) || d < 0 || d > 100) return null;
  return 1 - (d / 100) * 0.211;
}

// Calcul poids net (alcool seul, sans contenant)
function calculerPoidsNet(volume, degre) {
  const v = parseFloat(volume);
  const densite = calculerDensite(degre);
  if (isNaN(v) || densite === null) return null;
  return v * densite;
}

// Calcul poids brut = net + tare
function calculerPoidsBrut(poidsNet, contenants) {
  // contenants = [{type: 'ibc_1000', quantite: 2}, ...]
  if (poidsNet === null) return null;
  const tareTotal = contenants.reduce((sum, c) => {
    const cat = CONTENANTS_INITIAUX[c.type];
    const tareUnitaire = c.tareCustom !== undefined && c.tareCustom !== '' && c.tareCustom !== null
      ? parseFloat(c.tareCustom)
      : (cat ? cat.tare : 0);
    return sum + (parseFloat(c.quantite) || 0) * tareUnitaire;
  }, 0);
  return poidsNet + tareTotal;
}

// Détecter conditionnement depuis description Akanea
// Pattern: "50CT x 12 x 1,00L" ou "0CT x 6 x 0,70L" ou "745CT x 1 x 1,00L"
function detecterConditionnement(description) {
  const match = description.match(/(\d+)\s*CT\s*x\s*(\d+)\s*x\s*([\d,\.]+)\s*L/i);
  if (!match) return null;

  const nbCartons = parseInt(match[1]);
  const parCarton = parseInt(match[2]);
  const volUnit = parseFloat(match[3].replace(',', '.'));
  const descUp = description.toUpperCase();
  const estVrac = descUp.includes('LAP') || descUp.includes('CUVE') || descUp.includes('VRAC');

  // Bouteilles en cartons (cas normal)
  if (nbCartons > 0 && parCarton > 1 && volUnit <= 1 && !estVrac) {
    let contenantBouteille = 'bouteille_70cl';
    let contenantCarton = 'carton_12x70cl';
    if (volUnit >= 0.95 && volUnit <= 1.05) {
      contenantBouteille = 'bouteille_100cl';
      contenantCarton = parCarton === 12 ? 'carton_12x100cl' : 'carton_6x70cl';
    } else if (volUnit >= 0.65 && volUnit <= 0.75) {
      contenantBouteille = 'bouteille_70cl';
      contenantCarton = parCarton === 12 ? 'carton_12x70cl' : 'carton_6x70cl';
    } else if (volUnit >= 0.45 && volUnit <= 0.55) {
      contenantBouteille = 'bouteille_50cl';
    }
    return {
      type: 'bouteilles',
      contenants: [
        { type: contenantBouteille, quantite: nbCartons * parCarton },
        { type: contenantCarton, quantite: nbCartons },
      ],
    };
  }

  // Vrac LAP (ex: 745CT x 1 x 1,00L) — proposer IBC par défaut, opérateur ajuste
  if (estVrac) {
    return {
      type: 'vrac',
      contenants: [
        { type: 'ibc_1000', quantite: 1 },
      ],
    };
  }

  // Bouteilles hors carton (0CT x 6 x 0,70L pour vieux)
  if (nbCartons === 0 && parCarton > 0) {
    let contenantBouteille = 'bouteille_70cl';
    if (volUnit >= 0.95) contenantBouteille = 'bouteille_100cl';
    else if (volUnit <= 0.55) contenantBouteille = 'bouteille_50cl';
    return {
      type: 'bouteilles_libres',
      contenants: [
        { type: contenantBouteille, quantite: parCarton },
      ],
    };
  }

  return null;
}

// =============================================================================
// PARSING XML AKANEA
// =============================================================================

function parserXmlAkanea(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  // Vérifier les erreurs de parsing
  const erreur = doc.querySelector('parsererror');
  if (erreur) {
    throw new Error('XML invalide : ' + erreur.textContent);
  }

  const getText = (parent, tag) => {
    const el = parent?.querySelector(tag);
    return el ? el.textContent.trim() : '';
  };

  const root = doc.querySelector('DAA_DSA_CRE');
  if (!root) throw new Error('Pas de DAA_DSA_CRE trouvé dans le XML');

  const consignee = root.querySelector('ConsigneeTrader');
  const consignor = root.querySelector('ConsignorTrader');
  const placeOfDispatch = root.querySelector('PlaceOfDispatchTrader');
  const deliveryPlace = root.querySelector('DeliveryPlaceTrader');
  const transporter = root.querySelector('FirstTransporterTrader');
  const transportDetails = root.querySelector('TransportDetails');
  const eaadDraft = root.querySelector('EaadDraft');
  const headerEaad = root.querySelector('HeaderEaad');
  const transportMode = root.querySelector('TransportMode');
  const guarantee = root.querySelector('MovementGuarantee');

  // Lignes produits
  const bodies = root.querySelectorAll('BodyEaad');
  const lignes = Array.from(bodies).map((body, index) => {
    const description = getText(body, 'CommercialDescription');
    const strength = parseFloat(getText(body, 'AlcoholicStrength')) || 0;

    // Détection vrac LAP : si la description contient "LAP" ou si degré = 100%
    const estLap = /\bLAP\b/i.test(description) || strength === 100;

    // Parser le commentaire pour extraire les vraies valeurs si bouteilles
    // Format: "soit XXX,XXL a YY.Y% = ZZZ HAP"
    const match = description.match(/soit\s+([\d,\.]+)\s*L\s*a\s+([\d,\.]+)\s*%/i);
    const volumeCommentaire = match ? parseFloat(match[1].replace(',', '.')) : null;
    const degreCommentaire = match ? parseFloat(match[2].replace(',', '.')) : null;

    // Détection conditionnement et tare automatique
    const condit = detecterConditionnement(description);
    const grossWeightAkanea = parseFloat(getText(body, 'GrossWeight')) || 0;
    const netWeightAkanea = parseFloat(getText(body, 'NetWeight')) || 0;
    // Si vrac LAP : les poids Akanea sont presque toujours faux → on recalcule
    // Si bouteilles : les poids Akanea peuvent être OK mais on propose le calcul
    const poidsAkaneaSuspect = estLap;

    // Volume + degré DAE proposés
    const volumeDae = estLap ? '' : (volumeCommentaire || parseFloat(getText(body, 'Quantity')) || 0);
    const degreDae = estLap ? '' : (degreCommentaire || strength);

    // Pré-calcul poids si on a volume + degré
    let poidsNetCalc = null;
    let poidsBrutCalc = null;
    if (volumeDae !== '' && degreDae !== '') {
      poidsNetCalc = calculerPoidsNet(volumeDae, degreDae);
      if (condit) {
        poidsBrutCalc = calculerPoidsBrut(poidsNetCalc, condit.contenants);
      }
    }

    return {
      id: index + 1,
      exciseProductCode: getText(body, 'ExciseProductCode'),
      cnCode: getText(body, 'CnCode'),
      quantityAkanea: parseFloat(getText(body, 'Quantity')) || 0,
      strengthAkanea: strength,
      grossWeight: poidsAkaneaSuspect && poidsBrutCalc !== null ? +poidsBrutCalc.toFixed(2) : (poidsBrutCalc !== null ? +poidsBrutCalc.toFixed(2) : grossWeightAkanea),
      netWeight: poidsAkaneaSuspect && poidsNetCalc !== null ? +poidsNetCalc.toFixed(2) : (poidsNetCalc !== null ? +poidsNetCalc.toFixed(2) : netWeightAkanea),
      grossWeightAkanea, // pour comparaison
      netWeightAkanea,   // pour comparaison
      description,
      kindOfPackages: getText(body, 'KindOfPackages'),
      numberOfPackages: parseInt(getText(body, 'NumberOfPackages')) || 0,
      // Cas particulier
      estLap,
      poidsAkaneaSuspect,
      // Conditionnement
      contenants: condit ? condit.contenants : [],
      typeCondit: condit ? condit.type : 'inconnu',
      // Valeurs proposées pour le DAE
      quantityDae: volumeDae,
      strengthDae: degreDae,
      // Valeurs extraites du commentaire (pour info)
      volumeCommentaire,
      degreCommentaire,
    };
  });

  const paysConsignee = getText(consignee, 'Pays');
  const estExport = paysConsignee && !PAYS_UE.includes(paysConsignee.toUpperCase());

  return {
    consignee: {
      traderId: getText(consignee, 'Traderid'),
      traderName: getText(consignee, 'TraderName'),
      streetName: getText(consignee, 'StreetName'),
      postcode: getText(consignee, 'Postcode'),
      city: getText(consignee, 'City'),
      pays: paysConsignee,
    },
    consignor: {
      traderId: getText(consignor, 'Traderid'),
      traderName: getText(consignor, 'TraderName'),
      streetName: getText(consignor, 'StreetName'),
      postcode: getText(consignor, 'Postcode'),
      city: getText(consignor, 'City'),
      pays: getText(consignor, 'Pays'),
    },
    placeOfDispatch: {
      referenceOfTaxWarehouse: getText(placeOfDispatch, 'ReferenceOfTaxWarehouse'),
    },
    deliveryPlace: {
      traderId: getText(deliveryPlace, 'Traderid'),
      traderName: getText(deliveryPlace, 'TraderName'),
      streetName: getText(deliveryPlace, 'StreetName'),
      postcode: getText(deliveryPlace, 'Postcode'),
      city: getText(deliveryPlace, 'City'),
    },
    transporter: {
      traderName: getText(transporter, 'TraderName'),
      streetName: getText(transporter, 'StreetName'),
      postcode: getText(transporter, 'Postcode'),
      city: getText(transporter, 'City'),
    },
    transportDetails: {
      transportUnitCode: getText(transportDetails, 'TransportUnitCode'),
      identityOfTransportUnits: getText(transportDetails, 'IdentityOfTransportUnits'),
    },
    eaadDraft: {
      localReferenceNumber: getText(eaadDraft, 'LocalReferenceNumber'),
      invoiceNumber: getText(eaadDraft, 'InvoiceNumber'),
      invoiceDate: getText(eaadDraft, 'InvoiceDate'),
      originTypeCode: getText(eaadDraft, 'OriginTypeCode'),
      dateOfDispatch: getText(eaadDraft, 'DateOfDispatch'),
      timeOfDispatch: getText(eaadDraft, 'TimeOfDispatch'),
    },
    headerEaad: {
      destinationTypeCode: getText(headerEaad, 'DestinationTypeCode') || (estExport ? '6' : '1'),
      journeyTime: getText(headerEaad, 'JourneyTime') || 'D01',
      transportArrangement: getText(headerEaad, 'TransportArrangement') || '1',
    },
    transportMode: {
      transportModeCode: getText(transportMode, 'TransportModeCode') || '3',
    },
    guarantee: {
      guarantorTypeCode: getText(guarantee, 'GuarantorTypeCode') || '1',
    },
    competentAuthority: {
      referenceNumber: 'FR006610', // Bureau Pointe-à-Pitre par défaut
    },
    lignes,
    // Métadonnées
    estExport,
    forme: lignes.length > 0 ? (lignes.every(l => l.estLap) ? 'vrac' : 'bouteilles_ou_mixte') : 'inconnu',
  };
}

// =============================================================================
// GÉNÉRATION JSON DOUANE
// =============================================================================

function genererJsonDouane(data) {
  const numFacture = data.eaadDraft.invoiceNumber || 'SANSREF';
  const nomDest = data.consignee.traderName
    ? data.consignee.traderName.substring(0, 20).replace(/\s+/g, '_')
    : 'DRAFT';
  const draftName = `DAE_${numFacture}_${nomDest}`;
  const destinationCode = parseInt(data.headerEaad.destinationTypeCode) || 1;
  const estExport = destinationCode === 6;

  // === Structure officielle DTI+ GAMMA2 ===
  // Référence : Guide DTI+ douane.gouv.fr (PDF officiel)
  // ATTENTION : "DraftName" avec D majuscule (pas "draftName")
  // ATTENTION : valeurs numériques de BodyEadEsad en STRING (pas int/float)
  // ATTENTION : PlaceOfDispatchTrader nécessite ReferenceOfTaxWarehouse (commençant par "FR")
  // ATTENTION : Le numéro d'entrepôt EFS peut être identique au numéro d'accise opérateur,
  //             mais en cas d'EFS différent il faut le numéro EFS spécifique

  // Types de colis "bulk" INDÉNOMBRABLES : pas de NumberOfPackages selon règle IC_RG_C073_2
  // (cuves, citernes, vrac gaz, vrac solide — pas de notion d'unité)
  // Les IBC, fûts, bidons restent dénombrables.
  const KINDS_BULK = ['VL', 'VG', 'VQ', 'VR', 'VY', 'VO', 'VP', 'VS'];

  const submittedDraft = {
    ConsigneeTrader: {
      Traderid: data.consignee.traderId,
      TraderName: data.consignee.traderName,
      StreetName: data.consignee.streetName,
      Postcode: data.consignee.postcode,
      City: data.consignee.city,
    },
    ConsignorTrader: {
      TraderExciseNumber: data.consignor.traderId,
    },
    PlaceOfDispatchTrader: {
      // ReferenceOfTaxWarehouse : numéro EFS (commence par "FR") — OBLIGATOIRE
      ReferenceOfTaxWarehouse: data.placeOfDispatch.referenceOfTaxWarehouse,
      TraderName: data.consignor.traderName,
      StreetName: data.consignor.streetName,
      Postcode: data.consignor.postcode,
      City: data.consignor.city,
    },
    FirstTransporterTrader: {
      TraderName: data.transporter.traderName,
      StreetName: data.transporter.streetName,
      Postcode: data.transporter.postcode,
      City: data.transporter.city,
    },
    TransportDetails: [
      {
        TransportUnitCode: data.transportDetails.transportUnitCode,
        IdentityOfTransportUnits: data.transportDetails.identityOfTransportUnits,
      },
    ],
    EadEsad: {
      LocalReferenceNumber: `DAA_${numFacture}`,
      InvoiceNumber: String(numFacture),
      InvoiceDate: data.eaadDraft.invoiceDate,
      OriginTypeCode: parseInt(data.eaadDraft.originTypeCode) || 1,
      DateOfDispatch: data.eaadDraft.dateOfDispatch,
      TimeOfDispatch: data.eaadDraft.timeOfDispatch,
    },
    HeaderEadEsad: {
      DestinationTypeCode: destinationCode,
      JourneyTime: data.headerEaad.journeyTime,
      TransportArrangement: parseInt(data.headerEaad.transportArrangement) || 1,
    },
    TransportMode: {
      TransportModeCode: data.transportMode.transportModeCode,
    },
    MovementGuarantee: {
      GuarantorTypeCode: parseInt(data.guarantee.guarantorTypeCode) || 1,
    },
    BodyEadEsad: data.lignes.map((ligne, idx) => {
      const estBulk = KINDS_BULK.includes(ligne.kindOfPackages);
      const pkg = { KindOfPackages: ligne.kindOfPackages };
      // Règle IC_RG_C073_2 : NumberOfPackages interdit pour les types bulk (indénombrables)
      if (!estBulk) {
        pkg.NumberOfPackages = String(ligne.numberOfPackages);
      }
      return {
        BodyRecordUniqueReference: String(idx + 1),
        ExciseProductCode: ligne.exciseProductCode,
        CnCode: ligne.cnCode,
        Quantity: String(parseFloat(ligne.quantityDae)),
        GrossMass: String(parseFloat(ligne.grossWeight)),
        NetMass: String(parseFloat(ligne.netWeight)),
        AlcoholicStrengthByVolumeInPercentage: String(parseFloat(ligne.strengthDae)),
        Package: [pkg],
        CommercialDescription: {
          _content_: nettoyer_description(ligne.description),
          __language: 'fr',
        },
      };
    }),
    Attributes: {
      SubmissionMessageType: 1,
      DeferredSubmissionFlag: 0,
    },
    CompetentAuthorityDispatchOffice: {
      ReferenceNumber: data.competentAuthority.referenceNumber,
    },
  };

  // Cas DAE EXPORT (DestinationTypeCode = 6) :
  // - Supprimer DeliveryPlaceTrader
  // - Ajouter DeliveryPlaceCustomsOffice (bureau de douane de sortie)
  if (estExport) {
    // Numéro d'accise destinataire optionnel en export
    if (!data.consignee.traderId) {
      delete submittedDraft.ConsigneeTrader.Traderid;
    }
    // Bureau de douane de sortie OBLIGATOIRE en export
    submittedDraft.DeliveryPlaceCustomsOffice = {
      ReferenceNumber: data.deliveryPlaceCustomsOffice?.referenceNumber || 'FR006000',
    };
    // Pays tiers de destination
    if (data.exportCountry) {
      submittedDraft.ExportCountryDestination = data.exportCountry;
    }
  } else {
    // Cas non-export : DeliveryPlaceTrader requis
    submittedDraft.DeliveryPlaceTrader = {
      Traderid: data.deliveryPlace.traderId,
      TraderName: data.deliveryPlace.traderName,
      StreetName: data.deliveryPlace.streetName,
      Postcode: data.deliveryPlace.postcode,
      City: data.deliveryPlace.city,
    };
  }

  // TransportArrangement = 3 (commissionnaire) → bloc TransportArrangerTrader obligatoire
  const ta = parseInt(data.headerEaad.transportArrangement);
  if (ta === 3 && data.transportArrangerTrader) {
    submittedDraft.TransportArrangerTrader = data.transportArrangerTrader;
  }

  return {
    // CRITIQUE : "DraftName" avec D MAJUSCULE (pas draftName)
    DraftName: draftName,
    SubmittedDraftOfEADESAD: submittedDraft,
  };
}

// Nettoyer la description pour le DAE (enlever le détail commercial Akanea)
function nettoyer_description(desc) {
  // Garder uniquement la partie avant le " - "
  const parts = desc.split(' - ');
  return parts[0].trim();
}

// =============================================================================
// GÉNÉRATION XML AKANEA ENRICHI
// =============================================================================

function genererXmlAkanea(data) {
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(2)}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const escapeXml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const bodyEaads = data.lignes.map((ligne) => `            <BodyEaad>
                <ExciseProductCode>${escapeXml(ligne.exciseProductCode)}</ExciseProductCode>
                <CnCode>${escapeXml(ligne.cnCode)}</CnCode>
                <Quantity>${parseFloat(ligne.quantityDae).toFixed(2)}</Quantity>
                <GrossWeight>${ligne.grossWeight}</GrossWeight>
                <NetWeight>${ligne.netWeight}</NetWeight>
                <AlcoholicStrength>${parseFloat(ligne.strengthDae).toFixed(2)}</AlcoholicStrength>
                <CommercialDescription language="FR">${escapeXml(ligne.description)}</CommercialDescription>
                <Package>
                    <KindOfPackages>${escapeXml(ligne.kindOfPackages)}</KindOfPackages>
                    <NumberOfPackages>${ligne.numberOfPackages}</NumberOfPackages>
                </Package>
                <WineProduct>
                    <WineProductCategory>5</WineProductCategory>
                </WineProduct>
            </BodyEaad>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<MessageOperateur>
    <EnveloppeConnexion>
        <connexionId/>
        <interchangeAgreementId/>
        <numEnveloppe/>
        <DateTime>
            <date>${dateStr}</date>
            <time>${timeStr}</time>
        </DateTime>
        <applicationId>Gamma</applicationId>
    </EnveloppeConnexion>
    <Messages>
        <Message>
            <EnveloppeMessage>
                <schemaID>MFR815</schemaID>
                <schemaVersion>23/08/2011</schemaVersion>
                <partyId>${escapeXml(data.consignor.traderId)}</partyId>
                <transactionId>A_ATTRIBUER</transactionId>
                <numseq>0</numseq>
            </EnveloppeMessage>
            <MessageBody Type="EXPED">
                <EnEmission>
                    <DAA_DSA>
                        <DAA_DSA_CRE>
                            <ConsigneeTrader language="FR">
                                <Traderid>${escapeXml(data.consignee.traderId)}</Traderid>
                                <TraderName>${escapeXml(data.consignee.traderName)}</TraderName>
                                <StreetName>${escapeXml(data.consignee.streetName)}</StreetName>
                                <Postcode>${escapeXml(data.consignee.postcode)}</Postcode>
                                <City>${escapeXml(data.consignee.city)}</City>
                                <Pays>${escapeXml(data.consignee.pays)}</Pays>
                            </ConsigneeTrader>
                            <ConsignorTrader language="FR">
                                <Traderid>${escapeXml(data.consignor.traderId)}</Traderid>
                                <TraderName>${escapeXml(data.consignor.traderName)}</TraderName>
                                <StreetName>${escapeXml(data.consignor.streetName)}</StreetName>
                                <Postcode>${escapeXml(data.consignor.postcode)}</Postcode>
                                <City>${escapeXml(data.consignor.city)}</City>
                                <Pays>${escapeXml(data.consignor.pays)}</Pays>
                            </ConsignorTrader>
                            <PlaceOfDispatchTrader language="FR">
                                <ReferenceOfTaxWarehouse>${escapeXml(data.placeOfDispatch.referenceOfTaxWarehouse)}</ReferenceOfTaxWarehouse>
                            </PlaceOfDispatchTrader>
                            <DeliveryPlaceTrader language="FR">
                                <Traderid>${escapeXml(data.deliveryPlace.traderId)}</Traderid>
                                <TraderName>${escapeXml(data.deliveryPlace.traderName)}</TraderName>
                                <StreetName>${escapeXml(data.deliveryPlace.streetName)}</StreetName>
                                <Postcode>${escapeXml(data.deliveryPlace.postcode)}</Postcode>
                                <City>${escapeXml(data.deliveryPlace.city)}</City>
                            </DeliveryPlaceTrader>
                            <FirstTransporterTrader language="FR">
                                <TraderName>${escapeXml(data.transporter.traderName)}</TraderName>
                                <StreetName>${escapeXml(data.transporter.streetName)}</StreetName>
                                <Postcode>${escapeXml(data.transporter.postcode)}</Postcode>
                                <City>${escapeXml(data.transporter.city)}</City>
                            </FirstTransporterTrader>
                            <TransportDetails>
                                <TransportUnitCode>${escapeXml(data.transportDetails.transportUnitCode)}</TransportUnitCode>
                                <IdentityOfTransportUnits>${escapeXml(data.transportDetails.identityOfTransportUnits)}</IdentityOfTransportUnits>
                            </TransportDetails>
                            <EaadDraft>
                                <LocalReferenceNumber>${escapeXml(data.eaadDraft.localReferenceNumber)}</LocalReferenceNumber>
                                <InvoiceNumber>${escapeXml(data.eaadDraft.invoiceNumber)}</InvoiceNumber>
                                <InvoiceDate>${escapeXml(data.eaadDraft.invoiceDate)}</InvoiceDate>
                                <OriginTypeCode>${escapeXml(data.eaadDraft.originTypeCode)}</OriginTypeCode>
                                <DateOfDispatch>${escapeXml(data.eaadDraft.dateOfDispatch)}</DateOfDispatch>
                                <TimeOfDispatch>${escapeXml(data.eaadDraft.timeOfDispatch)}</TimeOfDispatch>
                            </EaadDraft>
                            <HeaderEaad>
                                <DestinationTypeCode>${escapeXml(data.headerEaad.destinationTypeCode)}</DestinationTypeCode>
                                <JourneyTime>${escapeXml(data.headerEaad.journeyTime)}</JourneyTime>
                                <TransportArrangement>${escapeXml(data.headerEaad.transportArrangement)}</TransportArrangement>
                            </HeaderEaad>
                            <TransportMode>
                                <TransportModeCode>${escapeXml(data.transportMode.transportModeCode)}</TransportModeCode>
                            </TransportMode>
                            <MovementGuarantee>
                                <GuarantorTypeCode>${escapeXml(data.guarantee.guarantorTypeCode)}</GuarantorTypeCode>
                                <GuarantorTrader language="FR">
                                    <TraderExciseNumber>${escapeXml(data.consignor.traderId)}</TraderExciseNumber>
                                    <StreetName>${escapeXml(data.consignor.streetName)}</StreetName>
                                    <City>${escapeXml(data.consignor.city)}</City>
                                </GuarantorTrader>
                            </MovementGuarantee>
${bodyEaads}
                        </DAA_DSA_CRE>
                    </DAA_DSA>
                </EnEmission>
            </MessageBody>
        </Message>
    </Messages>
    <ELIT>
        <codact>0</codact>
    </ELIT>
</MessageOperateur>`;
}

// =============================================================================
// VALIDATION
// =============================================================================

function validerData(data) {
  const erreurs = [];
  const alertes = [];

  // Champs obligatoires
  if (!data.consignee.traderId) erreurs.push('Destinataire : N° accises manquant');
  if (!data.consignee.traderName) erreurs.push('Destinataire : Nom manquant');
  if (!data.consignor.traderId) erreurs.push('Expéditeur : N° accises manquant');
  if (!data.transportDetails.identityOfTransportUnits) erreurs.push('Transport : Immatriculation manquante');
  if (!data.eaadDraft.invoiceNumber) erreurs.push('Facture : N° manquant');
  if (!data.eaadDraft.dateOfDispatch) erreurs.push('Date expédition manquante');

  // Contrôle EFS : doit commencer par "FR"
  if (data.placeOfDispatch.referenceOfTaxWarehouse && !data.placeOfDispatch.referenceOfTaxWarehouse.startsWith('FR')) {
    erreurs.push('Lieu d\'expédition : le numéro EFS doit commencer par "FR" (règle douane IC_RG_BR003_2)');
  }

  // Contrôle date d'expédition : doit être future ou aujourd'hui
  if (data.eaadDraft.dateOfDispatch) {
    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);
    const dateExp = new Date(data.eaadDraft.dateOfDispatch);
    if (dateExp < aujourdhui) {
      erreurs.push(`Date expédition (${data.eaadDraft.dateOfDispatch}) doit être ≥ aujourd'hui (règle douane FR_RG_R031_2)`);
    }
  }

  // Lignes
  data.lignes.forEach((ligne, idx) => {
    const num = idx + 1;
    if (!ligne.cnCode) erreurs.push(`Ligne ${num} : Code CN manquant`);
    if (!ligne.exciseProductCode) erreurs.push(`Ligne ${num} : Code produit accises manquant`);
    if (!ligne.quantityDae || parseFloat(ligne.quantityDae) <= 0) {
      erreurs.push(`Ligne ${num} : Volume réel manquant ou invalide`);
    }
    if (!ligne.strengthDae || parseFloat(ligne.strengthDae) <= 0 || parseFloat(ligne.strengthDae) > 100) {
      erreurs.push(`Ligne ${num} : Degré alcoolique manquant ou invalide`);
    }

    // Alerte cohérence LAP
    if (ligne.estLap && ligne.quantityDae && ligne.strengthDae) {
      const volume = parseFloat(ligne.quantityDae);
      const degre = parseFloat(ligne.strengthDae);
      const lapCalcule = volume * degre / 100;
      const lapAkanea = ligne.quantityAkanea * ligne.strengthAkanea / 100;
      const ecart = Math.abs(lapCalcule - lapAkanea);
      if (ecart > 1) {
        alertes.push(`Ligne ${num} : LAP calculé (${lapCalcule.toFixed(2)}) ≠ LAP Akanea (${lapAkanea.toFixed(2)}) — écart ${ecart.toFixed(2)}`);
      }
    }

    // Contrôles poids
    if (parseFloat(ligne.quantityDae) > 0 && parseFloat(ligne.strengthDae) > 0) {
      const poidsNetCalc = calculerPoidsNet(ligne.quantityDae, ligne.strengthDae);
      if (poidsNetCalc !== null) {
        // Densité implicite cohérente ?
        if (ligne.netWeight > 0) {
          const densiteImpl = ligne.netWeight / parseFloat(ligne.quantityDae);
          if (densiteImpl < 0.78 || densiteImpl > 1.01) {
            erreurs.push(`Ligne ${num} : densité implicite du poids net (${densiteImpl.toFixed(3)} kg/L) physiquement impossible`);
          } else if (Math.abs(ligne.netWeight - poidsNetCalc) / poidsNetCalc > 0.05) {
            alertes.push(`Ligne ${num} : poids net saisi (${ligne.netWeight} kg) diverge de >5% du calcul (${poidsNetCalc.toFixed(1)} kg)`);
          }
        }
        // Brut < Net : impossible
        if (ligne.grossWeight > 0 && ligne.netWeight > 0 && ligne.grossWeight < ligne.netWeight) {
          erreurs.push(`Ligne ${num} : poids brut (${ligne.grossWeight}) < poids net (${ligne.netWeight})`);
        }
        // Tare aberrante > 30% du net
        if (ligne.grossWeight > 0 && ligne.netWeight > 0) {
          const tare = ligne.grossWeight - ligne.netWeight;
          if (tare > 0.3 * ligne.netWeight) {
            alertes.push(`Ligne ${num} : tare élevée (${tare.toFixed(1)} kg = ${(tare/ligne.netWeight*100).toFixed(0)}% du net) — vérifier les contenants`);
          }
        }
      }
    }
  });

  return { erreurs, alertes, valide: erreurs.length === 0 };
}

// =============================================================================
// VALEURS PAR DÉFAUT (localStorage)
// =============================================================================

const DEFAUTS_INITIAUX = {
  expediteur: {
    traderId: 'FR000633N0007',
    traderName: 'MONTEBELLO DISTILLERIE',
    streetName: 'Section Carrère - ',
    postcode: '97170',
    city: 'Petit-Bourg',
    pays: 'FR',
  },
  transporteur: {
    traderName: 'MONTEBELLO DISTILLERIE',
    streetName: 'Section Carrère - ',
    postcode: '97170',
    city: 'Petit-Bourg',
  },
  vehicule: {
    transportUnitCode: '2',
    identityOfTransportUnits: '254-AZM-971',
  },
  transport: {
    modeCode: '3',
    journeyTime: 'D01',
    transportArrangement: '1',
    guarantorTypeCode: '1',
  },
  douane: {
    bureauReference: 'FR006610',
  },
};

function chargerDefauts() {
  try {
    const saved = localStorage.getItem('dae_defauts');
    return saved ? { ...DEFAUTS_INITIAUX, ...JSON.parse(saved) } : DEFAUTS_INITIAUX;
  } catch {
    return DEFAUTS_INITIAUX;
  }
}

function sauvegarderDefauts(defauts) {
  localStorage.setItem('dae_defauts', JSON.stringify(defauts));
}

// =============================================================================
// COMPOSANTS UI
// =============================================================================

function Header({ etape, onAccueil }) {
  return (
    <header style={{ background: COULEURS.gradient }} className="text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onAccueil}
            className="text-2xl font-bold tracking-wide hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'Cinzel Decorative, serif' }}
          >
            MONTEBELLO
          </button>
          <span className="text-white/60 text-sm font-light">|</span>
          <span className="text-sm uppercase tracking-widest opacity-90">DAE / EMCS Converter</span>
        </div>
        <div className="hidden md:flex items-center gap-2 text-sm">
          {['Import', 'Enrichissement', 'Export'].map((e, i) => (
            <div key={e} className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs uppercase tracking-wider ${
                etape === i + 1 ? 'bg-white text-[#7B1C1C] font-semibold' : 'bg-white/10'
              }`}>
                {i + 1}. {e}
              </span>
              {i < 2 && <span className="text-white/40">→</span>}
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

function EcranImport({ onParsed, defauts, onOuvrirParametres }) {
  const [erreur, setErreur] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (file) => {
    setErreur('');
    if (!file.name.toLowerCase().endsWith('.xml')) {
      setErreur('Le fichier doit être au format XML');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = parserXmlAkanea(e.target.result);
        // Appliquer les défauts si manquant
        if (!data.transporter.traderName) Object.assign(data.transporter, defauts.transporteur);
        if (!data.transportDetails.identityOfTransportUnits) {
          Object.assign(data.transportDetails, defauts.vehicule);
        }
        if (!data.competentAuthority.referenceNumber) {
          data.competentAuthority.referenceNumber = defauts.douane.bureauReference;
        }
        // Auto-corrige la date d'expédition si elle est dans le passé
        // (la douane refuse les dates antérieures à l'émission)
        const aujourdhui = new Date();
        aujourdhui.setHours(0, 0, 0, 0);
        const dateExp = data.eaadDraft.dateOfDispatch ? new Date(data.eaadDraft.dateOfDispatch) : null;
        if (!dateExp || dateExp < aujourdhui) {
          const demain = new Date();
          demain.setDate(demain.getDate() + 1);
          data.eaadDraft.dateOfDispatch = demain.toISOString().split('T')[0];
          data.eaadDraft.timeOfDispatch = '09:00:00';
        }
        onParsed(data);
      } catch (err) {
        setErreur(err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleSaisieManuelle = () => {
    // Date d'expédition par défaut : demain (la douane refuse les dates passées)
    const demain = new Date();
    demain.setDate(demain.getDate() + 1);
    const data = {
      consignee: { traderId: '', traderName: '', streetName: '', postcode: '', city: '', pays: 'FR' },
      consignor: { ...defauts.expediteur },
      placeOfDispatch: { referenceOfTaxWarehouse: defauts.expediteur.traderId },
      deliveryPlace: { traderId: '', traderName: '', streetName: '', postcode: '', city: '' },
      transporter: { ...defauts.transporteur },
      transportDetails: { ...defauts.vehicule },
      eaadDraft: {
        localReferenceNumber: '',
        invoiceNumber: '',
        invoiceDate: new Date().toISOString().split('T')[0],
        originTypeCode: '1',
        dateOfDispatch: demain.toISOString().split('T')[0],
        timeOfDispatch: '09:00:00',
      },
      headerEaad: {
        destinationTypeCode: '1',
        journeyTime: defauts.transport.journeyTime,
        transportArrangement: defauts.transport.transportArrangement,
      },
      transportMode: { transportModeCode: defauts.transport.modeCode },
      guarantee: { guarantorTypeCode: defauts.transport.guarantorTypeCode },
      competentAuthority: { referenceNumber: defauts.douane.bureauReference },
      lignes: [],
      estExport: false,
      forme: 'inconnu',
    };
    onParsed(data);
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2" style={{ fontFamily: 'Source Sans 3, sans-serif' }}>
          Convertir une facture en DAE
        </h1>
        <p className="text-gray-600">
          Importez un fichier XML exporté depuis Akanea, ou saisissez manuellement les informations.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
        }}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
          dragOver
            ? 'border-[#962824] bg-[#962824]/5'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400'
        }`}
      >
        <div className="text-5xl mb-4">📄</div>
        <h2 className="text-xl font-semibold mb-2">Glissez votre fichier XML Akanea ici</h2>
        <p className="text-gray-500 mb-6">ou</p>
        <label className="inline-block">
          <input
            type="file"
            accept=".xml"
            className="hidden"
            onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
          />
          <span
            className="inline-block px-6 py-3 rounded-lg text-white font-medium cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: COULEURS.cta }}
          >
            Sélectionner un fichier
          </span>
        </label>
      </div>

      {erreur && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          ⚠️ {erreur}
        </div>
      )}

      <div className="mt-6 text-center">
        <button
          onClick={handleSaisieManuelle}
          className="text-[#962824] hover:underline text-sm"
        >
          → Saisir manuellement (sans XML)
        </button>
      </div>

      <div className="mt-12 grid md:grid-cols-2 gap-4">
        <div className="p-5 bg-white border border-gray-200 rounded-lg">
          <div className="text-sm font-semibold text-gray-700 mb-2">📋 4 cas gérés</div>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• Local bouteilles (DAE intra-FR)</li>
            <li>• Local vrac (avec conversion LAP)</li>
            <li>• Export bouteilles</li>
            <li>• Export vrac</li>
          </ul>
        </div>
        <div className="p-5 bg-white border border-gray-200 rounded-lg">
          <div className="text-sm font-semibold text-gray-700 mb-2">⚙️ Paramètres</div>
          <p className="text-sm text-gray-600 mb-3">
            Valeurs par défaut (transporteur, véhicule, bureau de douane) mémorisées.
          </p>
          <button
            onClick={onOuvrirParametres}
            className="text-sm text-[#962824] hover:underline"
          >
            Configurer les valeurs par défaut →
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ titre, icone, children, badge }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-4">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">
          {icone} {titre}
        </h3>
        {badge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#962824]/10 text-[#962824] font-medium">
            {badge}
          </span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Champ({ label, value, onChange, type = 'text', placeholder, required, options, helper }) {
  const id = `champ-${label.replace(/\s+/g, '-')}`;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {options ? (
        <select
          id={id}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#962824] focus:border-transparent"
        >
          <option value="">— Sélectionner —</option>
          {Object.entries(options).map(([k, v]) => (
            <option key={k} value={k}>{k} — {v}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={type}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#962824] focus:border-transparent"
        />
      )}
      {helper && <p className="text-xs text-gray-500 mt-1">{helper}</p>}
    </div>
  );
}

function LigneProduit({ ligne, idx, onChange, onSupprimer }) {
  const update = (champ, valeur) => onChange({ ...ligne, [champ]: valeur });

  return (
    <div className={`border rounded-lg p-4 mb-3 ${ligne.estLap ? 'border-orange-300 bg-orange-50/40' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">Ligne {idx + 1}</span>
          {ligne.estLap && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-200 text-orange-900 font-medium">
              ⚠️ LAP détecté — vérifier volume + degré
            </span>
          )}
          {!ligne.estLap && ligne.volumeCommentaire && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-medium">
              ✓ Valeurs extraites du commentaire
            </span>
          )}
        </div>
        <button
          onClick={onSupprimer}
          className="text-xs text-red-600 hover:text-red-800"
        >
          Supprimer
        </button>
      </div>

      <div className="mb-3">
        <Champ
          label="Description commerciale"
          value={ligne.description}
          onChange={(v) => update('description', v)}
          helper={ligne.estLap ? 'Le degré 100% en LAP n\'est pas le degré réel — saisissez le vrai degré ci-dessous' : null}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Champ
          label="Code CN"
          value={ligne.cnCode}
          onChange={(v) => update('cnCode', v)}
          options={CN_CODES}
          required
        />
        <Champ
          label="Code accises"
          value={ligne.exciseProductCode}
          onChange={(v) => update('exciseProductCode', v)}
          required
        />
        <Champ
          label="Type colis"
          value={ligne.kindOfPackages}
          onChange={(v) => update('kindOfPackages', v)}
        />
        <Champ
          label="Nb colis"
          type="number"
          value={ligne.numberOfPackages}
          onChange={(v) => update('numberOfPackages', parseInt(v) || 0)}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-gray-200">
        <div className={ligne.estLap ? 'opacity-60' : ''}>
          <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Akanea (info)</div>
          <div className="text-xs text-gray-600">
            Quantité : {ligne.quantityAkanea}<br/>
            Degré : {ligne.strengthAkanea}%
          </div>
        </div>
        <Champ
          label="Volume réel (L) DAE"
          type="number"
          value={ligne.quantityDae}
          onChange={(v) => update('quantityDae', v)}
          required
          placeholder={ligne.estLap ? 'À renseigner' : ''}
        />
        <Champ
          label="Degré réel (%) DAE"
          type="number"
          value={ligne.strengthDae}
          onChange={(v) => update('strengthDae', v)}
          required
          placeholder={ligne.estLap ? 'À renseigner' : ''}
        />
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">LAP calculé</div>
          <div className="text-sm font-medium text-gray-700 pt-1">
            {ligne.quantityDae && ligne.strengthDae
              ? (parseFloat(ligne.quantityDae) * parseFloat(ligne.strengthDae) / 100).toFixed(4)
              : '—'}
          </div>
        </div>
      </div>

      {/* MODULE POIDS */}
      <ModulePoids ligne={ligne} onChange={onChange} />
    </div>
  );
}

// Sous-composant : calculateur de poids avec contenants
function ModulePoids({ ligne, onChange }) {
  const [deplie, setDeplie] = useState(ligne.poidsAkaneaSuspect || false);

  const volume = parseFloat(ligne.quantityDae) || 0;
  const degre = parseFloat(ligne.strengthDae) || 0;
  const densite = calculerDensite(degre);
  const poidsNetCalcule = volume > 0 && degre > 0 ? volume * densite : null;
  const poidsBrutCalcule = poidsNetCalcule !== null
    ? calculerPoidsBrut(poidsNetCalcule, ligne.contenants || [])
    : null;

  const tareTotal = poidsNetCalcule !== null && poidsBrutCalcule !== null
    ? poidsBrutCalcule - poidsNetCalcule
    : 0;

  // Comparaison avec Akanea
  const ecartAkanea = ligne.grossWeightAkanea > 0 && poidsBrutCalcule !== null
    ? Math.abs(poidsBrutCalcule - ligne.grossWeightAkanea) / poidsBrutCalcule * 100
    : null;

  // IMPORTANT : tous les handlers recalculent les poids à partir de la ligne FRAÎCHE
  // pour éviter le bug de stale closure (écrasement des valeurs récentes)
  const ajusterContenant = (idx, champ, valeur) => {
    const contenants = [...(ligne.contenants || [])];
    contenants[idx] = { ...contenants[idx], [champ]: valeur };
    const vol = parseFloat(ligne.quantityDae) || 0;
    const deg = parseFloat(ligne.strengthDae) || 0;
    const netCalc = vol > 0 && deg > 0 ? vol * calculerDensite(deg) : null;
    const brutCalc = netCalc !== null ? calculerPoidsBrut(netCalc, contenants) : null;
    onChange({
      ...ligne,
      contenants,
      grossWeight: brutCalc !== null ? +brutCalc.toFixed(2) : ligne.grossWeight,
    });
  };

  const supprimerContenant = (idx) => {
    const contenants = (ligne.contenants || []).filter((_, i) => i !== idx);
    const vol = parseFloat(ligne.quantityDae) || 0;
    const deg = parseFloat(ligne.strengthDae) || 0;
    const netCalc = vol > 0 && deg > 0 ? vol * calculerDensite(deg) : null;
    const brutCalc = netCalc !== null ? calculerPoidsBrut(netCalc, contenants) : null;
    onChange({
      ...ligne,
      contenants,
      grossWeight: brutCalc !== null ? +brutCalc.toFixed(2) : ligne.grossWeight,
    });
  };

  const ajouterContenant = () => {
    const contenants = [...(ligne.contenants || []), { type: 'ibc_1000', quantite: 1 }];
    const vol = parseFloat(ligne.quantityDae) || 0;
    const deg = parseFloat(ligne.strengthDae) || 0;
    const netCalc = vol > 0 && deg > 0 ? vol * calculerDensite(deg) : null;
    const brutCalc = netCalc !== null ? calculerPoidsBrut(netCalc, contenants) : null;
    onChange({
      ...ligne,
      contenants,
      grossWeight: brutCalc !== null ? +brutCalc.toFixed(2) : ligne.grossWeight,
    });
  };

  const appliquerCalcul = () => {
    // CRITIQUE : on relit volume et degré depuis ligne au moment du clic
    // (et pas depuis poidsNetCalcule capturé en closure qui peut être périmé)
    const vol = parseFloat(ligne.quantityDae) || 0;
    const deg = parseFloat(ligne.strengthDae) || 0;
    if (vol <= 0 || deg <= 0) {
      // Pas de calcul possible — on ne touche à rien
      return;
    }
    const netCalc = vol * calculerDensite(deg);
    const brutCalc = calculerPoidsBrut(netCalc, ligne.contenants || []);
    onChange({
      ...ligne,
      // On NE TOUCHE PAS à quantityDae ni strengthDae (garde-fou explicite)
      quantityDae: ligne.quantityDae,
      strengthDae: ligne.strengthDae,
      netWeight: +netCalc.toFixed(2),
      grossWeight: brutCalc !== null ? +brutCalc.toFixed(2) : +netCalc.toFixed(2),
    });
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <button
        onClick={() => setDeplie(!deplie)}
        className="flex items-center justify-between w-full text-left group"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">
            ⚖️ Poids
          </span>
          {ligne.poidsAkaneaSuspect && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-200 text-orange-900 font-medium">
              ⚠️ Poids Akanea incorrect (vrac)
            </span>
          )}
          {poidsNetCalcule !== null && (
            <span className="text-xs text-gray-600">
              Net <strong>{poidsNetCalcule.toFixed(1)} kg</strong>
              {poidsBrutCalcule !== null && (
                <> · Brut <strong>{poidsBrutCalcule.toFixed(1)} kg</strong></>
              )}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400 group-hover:text-gray-600">
          {deplie ? '▲ Masquer' : '▼ Détailler'}
        </span>
      </button>

      {deplie && (
        <div className="mt-3 bg-gray-50 rounded-lg p-4 border border-gray-200">
          {/* Calcul automatique du poids net */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 pb-3 border-b border-gray-200">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Densité</div>
              <div className="text-sm font-medium">
                {densite ? densite.toFixed(4) + ' kg/L' : '—'}
              </div>
              <div className="text-[10px] text-gray-400">à {degre || '?'}°</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Poids net calculé</div>
              <div className="text-sm font-semibold text-[#962824]">
                {poidsNetCalcule !== null ? poidsNetCalcule.toFixed(2) + ' kg' : '—'}
              </div>
              <div className="text-[10px] text-gray-400">{volume || '?'} L × densité</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Tare totale</div>
              <div className="text-sm font-medium">
                {tareTotal > 0 ? tareTotal.toFixed(2) + ' kg' : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Poids brut calculé</div>
              <div className="text-sm font-semibold text-[#962824]">
                {poidsBrutCalcule !== null ? poidsBrutCalcule.toFixed(2) + ' kg' : '—'}
              </div>
              <div className="text-[10px] text-gray-400">Net + Tare</div>
            </div>
          </div>

          {/* Liste des contenants */}
          <div className="mb-3">
            <div className="text-xs uppercase tracking-wider text-gray-600 mb-2 font-semibold">Contenants</div>
            {(ligne.contenants || []).length === 0 ? (
              <div className="text-xs text-gray-500 italic mb-2">Aucun contenant — le poids brut = poids net</div>
            ) : (
              (ligne.contenants || []).map((c, idx) => {
                const cat = CONTENANTS_INITIAUX[c.type];
                const tareUnit = c.tareCustom !== undefined && c.tareCustom !== '' && c.tareCustom !== null
                  ? parseFloat(c.tareCustom)
                  : (cat ? cat.tare : 0);
                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 mb-2 items-end">
                    <div className="col-span-5">
                      <select
                        value={c.type}
                        onChange={(e) => ajusterContenant(idx, 'type', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      >
                        {Object.entries(CONTENANTS_INITIAUX).map(([k, v]) => (
                          <option key={k} value={k}>{v.libelle}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        value={c.quantite}
                        onChange={(e) => ajusterContenant(idx, 'quantite', parseFloat(e.target.value) || 0)}
                        placeholder="Qté"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number"
                        step="0.01"
                        value={c.tareCustom !== undefined ? c.tareCustom : ''}
                        onChange={(e) => ajusterContenant(idx, 'tareCustom', e.target.value)}
                        placeholder={`Tare ${tareUnit} kg`}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      />
                    </div>
                    <div className="col-span-1 text-xs text-gray-600">
                      = {(c.quantite * tareUnit).toFixed(1)}
                    </div>
                    <div className="col-span-1">
                      <button
                        onClick={() => supprimerContenant(idx)}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            <button
              onClick={ajouterContenant}
              className="text-xs text-[#962824] hover:underline mt-1"
            >
              + Ajouter un contenant
            </button>
          </div>

          {/* Saisie manuelle + comparaison Akanea */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-gray-200">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Poids net retenu (kg)</label>
              <input
                type="number"
                step="0.01"
                value={ligne.netWeight || ''}
                onChange={(e) => onChange({...ligne, netWeight: parseFloat(e.target.value) || 0})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Poids brut retenu (kg)</label>
              <input
                type="number"
                step="0.01"
                value={ligne.grossWeight || ''}
                onChange={(e) => onChange({...ligne, grossWeight: parseFloat(e.target.value) || 0})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={appliquerCalcul}
                disabled={poidsNetCalcule === null}
                className="w-full px-3 py-2 rounded-md text-white text-xs font-medium disabled:opacity-40"
                style={{ backgroundColor: '#962824' }}
              >
                ⟳ Appliquer le calcul
              </button>
            </div>
          </div>

          {/* Comparaison Akanea (info) */}
          {(ligne.grossWeightAkanea > 0 || ligne.netWeightAkanea > 0) && (
            <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600">
              <div className="font-semibold mb-1 text-gray-500 uppercase tracking-wider">Akanea (référence)</div>
              <div className="flex gap-4">
                <span>Net : {ligne.netWeightAkanea} kg</span>
                <span>Brut : {ligne.grossWeightAkanea} kg</span>
                {ecartAkanea !== null && ecartAkanea > 5 && (
                  <span className="text-orange-700 font-medium">
                    ⚠️ Écart {ecartAkanea.toFixed(1)}% avec calcul
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Garde-fou densité */}
          {volume > 0 && ligne.netWeight > 0 && (() => {
            const densiteImplicite = ligne.netWeight / volume;
            if (densiteImplicite < 0.78 || densiteImplicite > 1.01) {
              return (
                <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                  ⚠️ Densité implicite {densiteImplicite.toFixed(3)} kg/L — physiquement incohérent (vérifier volume ou poids net)
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}
    </div>
  );
}

function EcranEnrichissement({ data, setData, onValider, onRetour }) {
  const updateChamp = (section, champ, valeur) => {
    setData({
      ...data,
      [section]: { ...data[section], [champ]: valeur },
    });
  };

  const updateLigne = (idx, ligne) => {
    const lignes = [...data.lignes];
    lignes[idx] = ligne;
    setData({ ...data, lignes });
  };

  const supprimerLigne = (idx) => {
    setData({ ...data, lignes: data.lignes.filter((_, i) => i !== idx) });
  };

  const ajouterLigne = () => {
    setData({
      ...data,
      lignes: [
        ...data.lignes,
        {
          id: data.lignes.length + 1,
          exciseProductCode: 'S200',
          cnCode: '22084011',
          quantityAkanea: 0,
          strengthAkanea: 0,
          grossWeight: 0,
          netWeight: 0,
          grossWeightAkanea: 0,
          netWeightAkanea: 0,
          description: '',
          kindOfPackages: 'CT',
          numberOfPackages: 0,
          estLap: false,
          poidsAkaneaSuspect: false,
          contenants: [],
          typeCondit: 'inconnu',
          quantityDae: '',
          strengthDae: '',
        },
      ],
    });
  };

  const validation = validerData(data);

  // Détection du cas pour affichage
  const cas = (() => {
    const exp = data.estExport ? 'Export' : 'Local';
    const aLap = data.lignes.some(l => l.estLap);
    const aBouteilles = data.lignes.some(l => l.cnCode === '22084039' || (l.numberOfPackages > 0 && !l.estLap));
    if (aLap && !aBouteilles) return `${exp} • Vrac`;
    if (aLap && aBouteilles) return `${exp} • Mixte (vrac + bouteilles)`;
    return `${exp} • Bouteilles`;
  })();

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button onClick={onRetour} className="text-sm text-gray-500 hover:text-gray-700 mb-2">
            ← Retour
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Enrichir les données</h1>
          <p className="text-sm text-gray-600">Cas détecté : <strong className="text-[#962824]">{cas}</strong></p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-gray-500">Facture</div>
          <div className="text-lg font-bold text-gray-900">N° {data.eaadDraft.invoiceNumber || '—'}</div>
        </div>
      </div>

      {/* Sélecteur Type DAE — TRÈS visible car critique pour la structure JSON */}
      <div className="bg-white border-2 border-[#962824] rounded-lg p-4 mb-4">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-3 font-semibold">
          Type de DAE
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { code: '1', libelle: 'Local FR', sous: 'Entrepôt fiscal / national', emoji: '🏭' },
            { code: '6', libelle: 'Export', sous: 'Hors UE (DROM, pays tiers)', emoji: '🌍' },
          ].map(opt => {
            const actif = data.headerEaad.destinationTypeCode === opt.code;
            return (
              <button
                key={opt.code}
                onClick={() => updateChamp('headerEaad', 'destinationTypeCode', opt.code)}
                className={`px-4 py-4 rounded-lg border-2 text-sm transition-all flex items-center gap-3 ${
                  actif
                    ? 'border-[#962824] bg-[#962824] shadow-md'
                    : 'border-gray-200 bg-white hover:border-gray-400'
                }`}
              >
                <div className="text-3xl">{opt.emoji}</div>
                <div className="text-left">
                  <div className={`font-semibold ${actif ? 'text-white' : 'text-gray-900'}`}>
                    {opt.libelle}
                  </div>
                  <div className={`text-xs ${actif ? 'text-white/90' : 'text-gray-500'}`}>
                    {opt.sous}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {data.headerEaad.destinationTypeCode === '6' && (
          <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded text-xs text-orange-800">
            ⚠️ Mode export : DeliveryPlaceTrader supprimé automatiquement, DeliveryPlaceCustomsOffice ajouté (bureau de douane de sortie obligatoire)
          </div>
        )}
      </div>

      {/* Lignes produits — section critique en premier */}
      <Section
        titre="Lignes produits"
        icone="📦"
        badge={`${data.lignes.length} ligne${data.lignes.length > 1 ? 's' : ''}`}
      >
        {data.lignes.map((ligne, idx) => (
          <LigneProduit
            key={idx}
            ligne={ligne}
            idx={idx}
            onChange={(l) => updateLigne(idx, l)}
            onSupprimer={() => supprimerLigne(idx)}
          />
        ))}
        <button
          onClick={ajouterLigne}
          className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-[#962824] hover:text-[#962824] transition-colors"
        >
          + Ajouter une ligne
        </button>
      </Section>

      {/* Destinataire */}
      <Section titre="Destinataire" icone="🏢" badge={data.estExport ? 'Export' : 'Local FR'}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <Champ label="N° accises" value={data.consignee.traderId} onChange={(v) => updateChamp('consignee', 'traderId', v)} required />
          <Champ label="Raison sociale" value={data.consignee.traderName} onChange={(v) => updateChamp('consignee', 'traderName', v)} required />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Champ label="Adresse" value={data.consignee.streetName} onChange={(v) => updateChamp('consignee', 'streetName', v)} />
          <Champ label="Code postal" value={data.consignee.postcode} onChange={(v) => updateChamp('consignee', 'postcode', v)} />
          <Champ label="Ville" value={data.consignee.city} onChange={(v) => updateChamp('consignee', 'city', v)} />
          <Champ label="Pays" value={data.consignee.pays} onChange={(v) => updateChamp('consignee', 'pays', v.toUpperCase())} placeholder="FR" />
        </div>
      </Section>

      {/* Transport */}
      <Section titre="Transport" icone="🚚">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <Champ label="Mode de transport" value={data.transportMode.transportModeCode} onChange={(v) => updateChamp('transportMode', 'transportModeCode', v)} options={MODES_TRANSPORT} required />
          <Champ label="Code unité transport" value={data.transportDetails.transportUnitCode} onChange={(v) => updateChamp('transportDetails', 'transportUnitCode', v)} />
          <Champ label="Immatriculation" value={data.transportDetails.identityOfTransportUnits} onChange={(v) => updateChamp('transportDetails', 'identityOfTransportUnits', v)} required />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Champ label="Durée trajet" value={data.headerEaad.journeyTime} onChange={(v) => updateChamp('headerEaad', 'journeyTime', v)} helper="H01, D01, D02..." />
          <Champ label="Transporteur" value={data.transporter.traderName} onChange={(v) => updateChamp('transporter', 'traderName', v)} />
        </div>
      </Section>

      {/* Dates et références */}
      <Section titre="Dates et références" icone="📅">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Champ label="N° facture" value={data.eaadDraft.invoiceNumber} onChange={(v) => updateChamp('eaadDraft', 'invoiceNumber', v)} required />
          <Champ label="Date facture" type="date" value={data.eaadDraft.invoiceDate} onChange={(v) => updateChamp('eaadDraft', 'invoiceDate', v)} />
          <Champ label="Date expédition" type="date" value={data.eaadDraft.dateOfDispatch} onChange={(v) => updateChamp('eaadDraft', 'dateOfDispatch', v)} required />
          <Champ label="Heure expédition" type="time" value={data.eaadDraft.timeOfDispatch?.substring(0, 5)} onChange={(v) => updateChamp('eaadDraft', 'timeOfDispatch', v + ':00')} />
          <Champ label="Type destination" value={data.headerEaad.destinationTypeCode} onChange={(v) => updateChamp('headerEaad', 'destinationTypeCode', v)} options={DESTINATION_TYPES} required />
          <Champ label="Bureau douane" value={data.competentAuthority.referenceNumber} onChange={(v) => updateChamp('competentAuthority', 'referenceNumber', v)} helper="FR006610 = Pointe-à-Pitre" />
        </div>
      </Section>

      {/* Récap validation */}
      <div className={`mt-6 p-5 rounded-lg ${validation.valide ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        {validation.valide ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <div className="font-semibold text-green-900">Données valides — prêt pour export</div>
              {validation.alertes.length > 0 && (
                <ul className="mt-2 text-sm text-orange-700 list-disc list-inside">
                  {validation.alertes.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">⚠️</span>
              <div className="font-semibold text-red-900">{validation.erreurs.length} champ(s) à compléter</div>
            </div>
            <ul className="text-sm text-red-700 list-disc list-inside space-y-1">
              {validation.erreurs.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-between">
        <button
          onClick={onRetour}
          className="px-5 py-2.5 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          ← Retour
        </button>
        <button
          onClick={onValider}
          disabled={!validation.valide}
          className={`px-6 py-2.5 rounded-lg text-white font-medium transition-opacity ${
            validation.valide ? 'hover:opacity-90' : 'opacity-40 cursor-not-allowed'
          }`}
          style={{ backgroundColor: COULEURS.cta }}
        >
          Exporter →
        </button>
      </div>
    </div>
  );
}

function EcranExport({ data, onRetour, onNouvelle }) {
  const [voirJson, setVoirJson] = useState(false);
  const [voirXml, setVoirXml] = useState(false);

  const json = genererJsonDouane(data);
  const xml = genererXmlAkanea(data);
  const jsonString = JSON.stringify(json, null, 2);
  const numFacture = data.eaadDraft.invoiceNumber || 'facture';

  const telecharger = (contenu, nomFichier, mimeType) => {
    const blob = new Blob([contenu], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <button onClick={onRetour} className="text-sm text-gray-500 hover:text-gray-700 mb-2">
          ← Modifier
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Exporter les fichiers</h1>
        <p className="text-sm text-gray-600">Facture {numFacture} — {data.lignes.length} ligne(s)</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {/* JSON Douane */}
        <div className="bg-white border-2 border-[#962824] rounded-lg overflow-hidden">
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-gray-900">📋 JSON Douane</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#962824]/10 text-[#962824] font-medium">
                Direct douane
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Fichier conforme prêt à être importé sur le portail des douanes (Gamma/EMCS).
            </p>
            <button
              onClick={() => telecharger(jsonString, `DAA${numFacture}.json`, 'application/json')}
              className="w-full py-2.5 rounded-lg text-white font-medium hover:opacity-90 transition-opacity mb-2"
              style={{ backgroundColor: COULEURS.cta }}
            >
              ⬇ Télécharger DAA{numFacture}.json
            </button>
            <button
              onClick={() => setVoirJson(!voirJson)}
              className="w-full py-1.5 text-xs text-gray-600 hover:text-gray-900"
            >
              {voirJson ? 'Masquer' : 'Voir'} le contenu
            </button>
          </div>
          {voirJson && (
            <pre className="bg-gray-900 text-green-300 text-xs p-4 overflow-auto max-h-96">
              {jsonString}
            </pre>
          )}
        </div>

        {/* XML Akanea */}
        <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-gray-900">📄 XML Akanea</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
                Ré-import Akanea
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              XML enrichi avec les valeurs corrigées (volumes réels, degrés réels).
            </p>
            <button
              onClick={() => telecharger(xml, `aka${numFacture}.xml`, 'application/xml')}
              className="w-full py-2.5 rounded-lg bg-gray-800 text-white font-medium hover:bg-gray-900 transition-colors mb-2"
            >
              ⬇ Télécharger aka{numFacture}.xml
            </button>
            <button
              onClick={() => setVoirXml(!voirXml)}
              className="w-full py-1.5 text-xs text-gray-600 hover:text-gray-900"
            >
              {voirXml ? 'Masquer' : 'Voir'} le contenu
            </button>
          </div>
          {voirXml && (
            <pre className="bg-gray-900 text-blue-300 text-xs p-4 overflow-auto max-h-96">
              {xml}
            </pre>
          )}
        </div>
      </div>

      {/* Récap */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">Récapitulatif</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-500 uppercase">Destinataire</div>
            <div className="font-medium">{data.consignee.traderName}</div>
            <div className="text-xs text-gray-600">{data.consignee.city} ({data.consignee.pays})</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Total volume</div>
            <div className="font-medium">
              {data.lignes.reduce((s, l) => s + parseFloat(l.quantityDae || 0), 0).toFixed(2)} L
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Total LAP</div>
            <div className="font-medium">
              {data.lignes.reduce((s, l) => s + (parseFloat(l.quantityDae || 0) * parseFloat(l.strengthDae || 0) / 100), 0).toFixed(4)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Transport</div>
            <div className="font-medium">{data.transportDetails.identityOfTransportUnits}</div>
            <div className="text-xs text-gray-600">{MODES_TRANSPORT[data.transportMode.transportModeCode]}</div>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-between">
        <button
          onClick={onRetour}
          className="px-5 py-2.5 text-gray-700 hover:bg-gray-100 rounded-lg"
        >
          ← Modifier
        </button>
        <button
          onClick={onNouvelle}
          className="px-6 py-2.5 rounded-lg text-white font-medium hover:opacity-90"
          style={{ backgroundColor: COULEURS.primaire }}
        >
          + Nouvelle conversion
        </button>
      </div>
    </div>
  );
}

function ModaleParametres({ defauts, setDefauts, onFermer }) {
  const [draft, setDraft] = useState(defauts);

  const handleSave = () => {
    sauvegarderDefauts(draft);
    setDefauts(draft);
    onFermer();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="p-5 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-bold">Valeurs par défaut</h2>
          <button onClick={onFermer} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">Expéditeur</h3>
            <div className="grid grid-cols-2 gap-3">
              <Champ label="N° accises" value={draft.expediteur.traderId} onChange={(v) => setDraft({...draft, expediteur: {...draft.expediteur, traderId: v}})} />
              <Champ label="Raison sociale" value={draft.expediteur.traderName} onChange={(v) => setDraft({...draft, expediteur: {...draft.expediteur, traderName: v}})} />
              <Champ label="Adresse" value={draft.expediteur.streetName} onChange={(v) => setDraft({...draft, expediteur: {...draft.expediteur, streetName: v}})} />
              <Champ label="Code postal" value={draft.expediteur.postcode} onChange={(v) => setDraft({...draft, expediteur: {...draft.expediteur, postcode: v}})} />
              <Champ label="Ville" value={draft.expediteur.city} onChange={(v) => setDraft({...draft, expediteur: {...draft.expediteur, city: v}})} />
              <Champ label="Pays" value={draft.expediteur.pays} onChange={(v) => setDraft({...draft, expediteur: {...draft.expediteur, pays: v}})} />
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">Véhicule par défaut</h3>
            <div className="grid grid-cols-2 gap-3">
              <Champ label="Code unité" value={draft.vehicule.transportUnitCode} onChange={(v) => setDraft({...draft, vehicule: {...draft.vehicule, transportUnitCode: v}})} />
              <Champ label="Immatriculation" value={draft.vehicule.identityOfTransportUnits} onChange={(v) => setDraft({...draft, vehicule: {...draft.vehicule, identityOfTransportUnits: v}})} />
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">Transport</h3>
            <div className="grid grid-cols-2 gap-3">
              <Champ label="Mode" value={draft.transport.modeCode} onChange={(v) => setDraft({...draft, transport: {...draft.transport, modeCode: v}})} options={MODES_TRANSPORT} />
              <Champ label="Durée trajet" value={draft.transport.journeyTime} onChange={(v) => setDraft({...draft, transport: {...draft.transport, journeyTime: v}})} helper="H01, D01, D02..." />
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">Bureau douane</h3>
            <Champ label="Référence" value={draft.douane.bureauReference} onChange={(v) => setDraft({...draft, douane: {...draft.douane, bureauReference: v}})} helper="FR006610 = Pointe-à-Pitre" />
          </div>
        </div>
        <div className="p-5 border-t border-gray-200 flex justify-end gap-3 sticky bottom-0 bg-white">
          <button onClick={onFermer} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">
            Annuler
          </button>
          <button onClick={handleSave} className="px-5 py-2 rounded-lg text-white font-medium" style={{backgroundColor: COULEURS.cta}}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// APP PRINCIPALE
// =============================================================================

export default function App() {
  const [etape, setEtape] = useState(1);
  const [data, setData] = useState(null);
  const [defauts, setDefauts] = useState(chargerDefauts());
  const [parametresOuverts, setParametresOuverts] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: 'Source Sans 3, system-ui, sans-serif' }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&family=Source+Sans+3:wght@300;400;500;600;700&display=swap" />

      <Header
        etape={etape}
        onAccueil={() => { setEtape(1); setData(null); }}
      />

      {etape === 1 && (
        <EcranImport
          defauts={defauts}
          onParsed={(d) => { setData(d); setEtape(2); }}
          onOuvrirParametres={() => setParametresOuverts(true)}
        />
      )}

      {etape === 2 && data && (
        <EcranEnrichissement
          data={data}
          setData={setData}
          onValider={() => setEtape(3)}
          onRetour={() => setEtape(1)}
        />
      )}

      {etape === 3 && data && (
        <EcranExport
          data={data}
          onRetour={() => setEtape(2)}
          onNouvelle={() => { setData(null); setEtape(1); }}
        />
      )}

      {parametresOuverts && (
        <ModaleParametres
          defauts={defauts}
          setDefauts={setDefauts}
          onFermer={() => setParametresOuverts(false)}
        />
      )}
    </div>
  );
}
