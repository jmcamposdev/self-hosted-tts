import math
import unittest
import numpy as np
from ctc_segmentation import CtcSegmentationParameters, ctc_segmentation, determine_utterance_segments
from alignment_service.core import prepare_words


class CtcBoundaryTests(unittest.TestCase):
    def test_explicit_word_delimiter_is_not_replaced_with_ctc_blank(self):
        # Acoustic frames for "a | y | a" with blanks around each emitted token.
        sequence=[0]*3
        for token in [1,2,3,2,1]:sequence += [token]*4+[0]*3
        lp=np.full((len(sequence),4),-14.,dtype=np.float64)
        lp[np.arange(len(sequence)),sequence]=-.001
        config=CtcSegmentationParameters(char_list=['<pad>','a','|','y'])
        config.blank=0;config.index_duration=.02
        tokens=[np.array([1]),np.array([3]),np.array([1])]
        ground,begins=prepare_words(config,tokens,2)
        timings,probs,_=ctc_segmentation(config,lp,ground)
        spans=determine_utterance_segments(config,begins,probs,timings,['a','y','a'])
        self.assertEqual(len(spans),3)
        self.assertTrue(all(s<e and math.exp(score)>.1 for s,e,score in spans))
        self.assertLessEqual(spans[-1][1],len(sequence)*.02)


if __name__=='__main__':unittest.main()
