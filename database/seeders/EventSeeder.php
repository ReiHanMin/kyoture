<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Event;

class EventSeeder extends Seeder
{
    public function run()
    {
        Event::create([
            'title' => 'ROHM Theatre Kyoto Repertory Premiere',
            'date' => '2024-06-04',
            'imageUrl' => 'https://rohmtheatrekyoto.jp/wp-content/uploads/20240209_J_tangent_-2-1-768x511.jpg',
            'eventLink' => 'https://rohmtheatrekyoto.jp/en/event/125501/',
            'status' => 'Ended',
            'modalContent' => 'Shiro Takatani "Tangent" in Estonia and Venice.'
        ]);

        Event::create([
            'title' => 'Play! Theater in Summer 2024',
            'date' => '2024-07-20',
            'imageUrl' => 'https://rohmtheatrekyoto.jp/wp-content/uploads/20240720_playtheatrestageplogram-768x512.jpg',
            'eventLink' => 'https://rohmtheatrekyoto.jp/en/event/123862/',
            'status' => 'Ended',
            'modalContent' => 'Own Two Feet by Midnight Theatre Company from Iceland.'
        ]);

        Event::create([
            'title' => 'Charity Noh Performance: Prayers from Kyoto',
            'date' => '2024-08-22',
            'imageUrl' => 'https://rohmtheatrekyoto.jp/wp-content/uploads/20240822_J_nougakucharity-1-768x570.jpg',
            'eventLink' => 'https://rohmtheatrekyoto.jp/en/event/123913/',
            'status' => 'Ended',
            'modalContent' => 'Charity Noh Performance supporting disaster victims.'
        ]);

        Event::create([
            'title' => 'Giacomo Puccini: Opera “La Bohème”',
            'date' => '2024-10-06',
            'imageUrl' => 'https://rohmtheatrekyoto.jp/wp-content/uploads/20241006_J_La-Boheme-543x768.jpg',
            'eventLink' => 'https://rohmtheatrekyoto.jp/en/event/123953/',
            'status' => 'Ended',
            'modalContent' => 'All Japan Opera Co-Production Project 2024.'
        ]);

        Event::create([
            'title' => 'Rachid Ouramdane “Corps extrêmes”',
            'date' => '2024-11-02',
            'imageUrl' => 'https://rohmtheatrekyoto.jp/wp-content/uploads/173f415fb79723beebf5e889154d45ba-768x512.jpg',
            'eventLink' => 'https://rohmtheatrekyoto.jp/en/event/123960/',
            'status' => null,
            'modalContent' => 'Extreme physical and mental performance by Rachid Ouramdane.'
        ]);
    }
}
