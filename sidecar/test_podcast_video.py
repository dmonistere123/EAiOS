import unittest
from podcast_video import make_scenes, render_frame

class TestPromoLayouts(unittest.TestCase):
    def test_every_layout_with_one_to_four_labels_and_fractional_coordinates(self):
        for layout in ['flow','people','comparison','cycle','warning','checklist']:
            for count in range(1,5):
                with self.subTest(layout=layout,count=count):
                    plan={'title':'A clear handoff','audioDuration':85,'duration':90,'scenes':[{'at':0,'title':'Improve the system','subtitle':'Make ownership clear.','visual':layout,'labels':['An accountable owner']*count}]}
                    scenes=make_scenes(plan)
                    for t in [1.5,84.8,89.8]:
                        image=render_frame(t,scenes,show_hand=True)
                        self.assertEqual(image.size,(1280,720))

if __name__=='__main__':unittest.main()
