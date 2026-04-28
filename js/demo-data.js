/* ── Demo scenario ── */
window.DEMO_DOCS = {
  marksheet: {
    name: '10th_marksheet_ramesh_k.pdf',
    type: 'marksheet',
    demo: true,
    content: `TAMIL NADU STATE BOARD - SECONDARY SCHOOL LEAVING CERTIFICATE
Student Name: RAMESH KUMAR K
Date of Birth: 15/03/2006
Father's Name: KRISHNAMURTHY K
Mother's Name: LAKSHMI K
Register Number: TN20230445
School: GOVT. HIGH SCHOOL, COIMBATORE
Year of Passing: 2023  Standard: X (10th)
Tamil: 85  English: 72  Mathematics: 90  Science: 88  Social Science: 76
Total: 411/500  Grade: A+
Certificate No: TNSLC-2023-0045678  Date of Issue: 15/06/2023`
  },
  community: {
    name: 'community_certificate.pdf',
    type: 'community',
    demo: true,
    content: `OFFICE OF THE REVENUE DIVISIONAL OFFICER
COMMUNITY CERTIFICATE
Name: RAMESH KUMAR K
Son of: Krishnamurthy K
Resident of: 14/A, Gandhi Nagar, Coimbatore - 641001
Date of Birth: 15/03/2006
Community: OBC (Other Backward Class)
Sub-caste: NADAR   State: Tamil Nadu
Certificate No: CC/CBE/2023/4521
Date of Issue: 20/07/2023
Issuing Authority: RDO, Coimbatore`
  },
  income: {
    name: 'income_certificate_2023.pdf',
    type: 'income',
    demo: true,
    content: `CERTIFICATE OF FAMILY INCOME
Tahsildar Office, Coimbatore
Name of Head of Family: KRISHNAMURTY K
Son of: KANDASAMY
Address: 14A Gandhi Nagar, Coimbatore
Annual Family Income: Rs. 1,20,000/- (Rupees One Lakh Twenty Thousand Only)
Occupation: Daily Wage Labourer
Dependents: 4
Cert No: INC/CBE/2023/8891   Date of Issue: 05/08/2023
Note: Applicant owns a 3-bedroom house and two registered vehicles as per property records.`
  },
  aadhar: {
    name: 'aadhar_card_scan.jpg',
    type: 'id',
    demo: true,
    content: `UNIQUE IDENTIFICATION AUTHORITY OF INDIA
AADHAAR CARD
Name: Ramesh Kumar
Date of Birth: 15/03/2007
Gender: Male
Address: 14/A Gandhi Nagar, Coimbatore, Tamil Nadu 641001
Aadhaar No: XXXX XXXX 5678`
  }
};

window.DEMO_SLOT_TYPES = [
  { id: 'marksheet', label: 'Document 1', title: '10th Marksheet',        sub: 'School board SSLC certificate',   icon: '📋' },
  { id: 'community', label: 'Document 2', title: 'Community Certificate', sub: 'Caste / nativity certificate',     icon: '📜' },
  { id: 'income',    label: 'Document 3', title: 'Income Certificate',    sub: 'Family income declaration',        icon: '💰' },
  { id: 'aadhar',   label: 'Document 4', title: 'Aadhaar / ID Card',     sub: 'Government identity document',     icon: '🪪' },
];
