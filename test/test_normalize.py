import unittest
from alignment_service.normalize import normalize


class NormalizeTests(unittest.TestCase):
    def test_numbers_dates_accents_and_original_mapping(self):
        text='El 12/03/1673 tenía 21 años. Costó 3,50 euros.\n\nAdiós.'
        result=normalize(text)
        self.assertIn('doce de marzo de mil seiscientos setenta y tres',result['spoken_text'])
        self.assertIn('veintiuno años',result['spoken_text'])
        self.assertIn('tres coma cinco cero',result['spoken_text'])
        self.assertEqual(result['original_text'],text)
        self.assertEqual(''.join(text[m['source_start']:m['source_end']] for m in result['mappings']),text)
        self.assertEqual(''.join(result['spoken_text'][m['spoken_start']:m['spoken_end']] for m in result['mappings']),result['spoken_text'])

    def test_invalid_date_and_huge_number_fail(self):
        with self.assertRaises(ValueError):normalize('Día 31/02/2026')
        with self.assertRaises(ValueError):normalize('Número 1234567890123456')

    def test_no_expansions_preserve_whitespace(self):
        text='  Árbol.\n\nMás emoción, sin etiquetas.  '
        self.assertEqual(normalize(text)['spoken_text'],text)


if __name__=='__main__':unittest.main()
